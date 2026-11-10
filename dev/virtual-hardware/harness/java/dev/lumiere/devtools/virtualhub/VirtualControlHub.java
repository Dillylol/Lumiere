package dev.lumiere.devtools.virtualhub;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;

import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.internal.opmode.OpModeMeta;
import org.firstinspires.ftc.robotcore.internal.opmode.RegisteredOpModes;

import dev.lumiere.ftc.Stream;
import dev.lumiere.ftc.internal.Json;
import dev.lumiere.ftc.internal.RobotHooks;
import dev.lumiere.ftc.internal.StreamServer;
import dev.lumiere.sim.DrivetrainDiscovery;
import dev.lumiere.sim.GamepadState;
import dev.lumiere.sim.OpModeCatalog;
import dev.lumiere.sim.Simulation;
import dev.lumiere.sim.SimulatorConfig;
import dev.lumiere.sim.hardware.SimHardware;
import dev.lumiere.sim.hardware.SimHardwareMap;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * A virtual REV Control Hub, for development only: the project's OpModes drive the desktop
 * simulator's robot, and apps see them through the unmodified robot library, exactly as on a hub.
 *
 * <p>Startup follows the Robot Controller. OpModes are registered with the OpMode registry, then the
 * robot library's {@code @OnCreateEventLoop} hook ({@link RobotHooks}) is called with an event loop
 * whose OpMode manager is a {@link VirtualOpModeManager}. The hook starts the robot library's stream
 * server on port 58080 on every interface, as on a hub. Nothing in the robot library is replaced; only
 * the hub's platform is: the event loop, the OpMode manager, and the registry (which the SDK fills by
 * scanning its APK and cannot initialize on a desktop JVM).
 *
 * <p>A hub takes its orders from the Driver Station, so this one has a Driver Station channel: a
 * token-protected WebSocket on 127.0.0.1 that accepts the simulator protocol's commands (init, start,
 * stop, gamepad, place, shutdown) and reports what a Driver Station shows (OpModes, phase, telemetry,
 * errors), plus the simulated robot's true pose. The channel is never installed into {@link Stream},
 * so apps on the robot stream receive only what the robot library sends.
 */
public final class VirtualControlHub implements AutoCloseable {
    public static final String DS_PORT_PROPERTY = "vh.dsPort";
    public static final String CONFIG_PROPERTY = "vh.config";
    public static final String TOKEN_ENVIRONMENT = "VH_TOKEN";
    public static final String BOOT_DELAY_PROPERTY = "vh.bootDelayMs";
    /** Printed when the robot library's stream is up, before OpModes and hardware are ready. */
    public static final String STREAM_UP_LINE = "VIRTUAL_HUB_STREAM_UP";
    /** Printed when startup has finished and the Driver Station channel accepts connections. */
    public static final String READY_LINE = "VIRTUAL_HUB_READY";

    private static final long REPORT_INTERVAL_MS = 100;
    private static final long IDLE_EXIT_MS = 120_000;

    /** Set to list the deliberately faulty OpModes in {@code dev.lumiere.devtools.virtualhub.faults}. */
    public static final String FAULTS_PROPERTY = "vh.faults";
    private static final String FAULTS_PACKAGE = "dev.lumiere.devtools.virtualhub.faults";
    /** Set to list a Lumière Live OpMode paired with the secret in VH_LIVE_SECRET (contract checks). */
    public static final String LIVE_PROPERTY = "vh.live";
    private static final String LIVE_PACKAGE = "dev.lumiere.devtools.virtualhub.live";

    private final SimulatorConfig config;
    private final List<OpModeCatalog.Entry> opModes;
    private final Simulation simulation;
    private final StreamServer driverStation;
    private final CountDownLatch shutdown = new CountDownLatch(1);
    // Replaced when the robot restarts, as the Robot Controller creates a new event loop.
    private volatile VirtualOpModeManager manager;
    private volatile OpMode pending;
    private volatile List<String> lastTelemetry = Collections.emptyList();
    private volatile boolean booted;

    public VirtualControlHub(SimulatorConfig config, int driverStationPort, String token) {
        this.config = config;
        List<OpModeCatalog.Entry> found = new ArrayList<>(OpModeCatalog.scan(config.packagePrefix));
        if (System.getProperty(FAULTS_PROPERTY) != null) found.addAll(OpModeCatalog.scan(FAULTS_PACKAGE));
        if (System.getProperty(LIVE_PROPERTY) != null) found.addAll(OpModeCatalog.scan(LIVE_PACKAGE));
        this.opModes = Collections.unmodifiableList(found);
        this.manager = VirtualOpModeManager.create(this::stopRequestedByRobotLibrary);
        // The check's Lumière Live builds the project's own follower from this class.
        System.setProperty(dev.lumiere.devtools.virtualhub.live.VirtualLive.CONSTANTS_PROPERTY, config.constantsClass);
        DrivetrainDiscovery.Drivetrain drivetrain = DrivetrainDiscovery.discover(config.constantsClass);
        this.simulation = new Simulation(config.robot, drivetrain, config.startX, config.startY, config.startHeading, new Simulation.Listener() {
            @Override
            public void onPhase(String opMode, Simulation.Phase phase) {
                switch (phase) {
                    case INIT:
                        manager.initializing(opMode, pending);
                        break;
                    case RUNNING:
                        manager.starting();
                        break;
                    case STOPPED:
                        manager.stopped();
                        break;
                    default:
                        break;
                }
                log("%s: %s", opMode, phase.name().toLowerCase(Locale.ROOT));
                toDriverStation(lifecycle(opMode, phase));
            }

            @Override
            public void onFailure(String opMode, Throwable failure) {
                log("%s failed: %s", opMode, failure);
                toDriverStation(Stream.encode("error", errorBody(opMode, failure)));
            }
        });
        for (SimulatorConfig.Device device : config.devices) device.declareIn(simulation.hardware());
        if (System.getProperty(LIVE_PROPERTY) != null) {
            // Mechanism devices the Lumière Live checks can drive on any project.
            simulation.hardware().declare(com.qualcomm.robotcore.hardware.DcMotorEx.class, "lumiere_check_motor");
            simulation.hardware().declare(com.qualcomm.robotcore.hardware.Servo.class, "lumiere_check_servo");
        }
        this.driverStation = new StreamServer("127.0.0.1", driverStationPort, token, this::greeting, this::onCommand);
    }

    /** Runs the hub from the system properties the init script passes, until shutdown. */
    public static void runFromSystemProperties() throws Exception {
        String token = System.getenv(TOKEN_ENVIRONMENT);
        if (token == null || token.length() < 16) throw new IllegalArgumentException("Set " + TOKEN_ENVIRONMENT + " to at least 16 characters.");
        int port = Integer.parseInt(System.getProperty(DS_PORT_PROPERTY, "0"));
        String configPath = System.getProperty(CONFIG_PROPERTY);
        SimulatorConfig config = SimulatorConfig.load(configPath == null || configPath.isEmpty() ? null : Paths.get(configPath));
        try (VirtualControlHub hub = new VirtualControlHub(config, port, token)) {
            hub.run();
        }
    }

    public void run() throws IOException, InterruptedException {
        boot();
        driverStation.begin();
        Thread reporter = new Thread(this::report, "virtual-hub-report");
        reporter.setDaemon(true);
        reporter.start();
        System.out.println(READY_LINE + " robot=" + Stream.ROBOT_PORT + " ds=" + driverStation.getListeningPort());
        System.out.flush();
        long lastSeen = System.currentTimeMillis();
        try {
            while (!shutdown.await(1, TimeUnit.SECONDS)) {
                if (driverStation.hasClients() || Stream.hasClients()) lastSeen = System.currentTimeMillis();
                else if (System.currentTimeMillis() - lastSeen > IDLE_EXIT_MS) {
                    log("no Driver Station or app connected for %d s; shutting down", IDLE_EXIT_MS / 1000);
                    break;
                }
            }
        } finally {
            reporter.interrupt();
        }
    }

    /**
     * The Robot Controller's startup, in its order (FtcRobotControllerActivity.requestRobotSetup and
     * FtcEventLoop.init in SDK 12.0): the {@code @OnCreateEventLoop} hooks run as robot setup begins,
     * before OpModes are registered and the hardware map is built; then the SDK initializes and starts
     * its default OpMode. {@value #BOOT_DELAY_PROPERTY} stretches the gap, as a slow hub would, so
     * tests can connect while the robot is still starting.
     */
    private void boot() throws IOException, InterruptedException {
        requirePortFree(Stream.ROBOT_PORT);
        RobotHooks.onCreateEventLoop(null, VirtualEventLoop.create(manager));
        booted = true;
        if (manager.listenerCount() != 1) {
            throw new IllegalStateException("The robot library's @OnCreateEventLoop hook did not start (it registered "
                    + manager.listenerCount() + " OpMode listeners). Check that the robot library is on the classpath.");
        }
        if (!listening(Stream.ROBOT_PORT)) {
            throw new IllegalStateException("The robot library's stream server is not listening on port " + Stream.ROBOT_PORT + ".");
        }
        log("robot library %s streaming on port %d (all interfaces, as on a hub)", Stream.libraryVersion(), Stream.ROBOT_PORT);
        System.out.println(STREAM_UP_LINE + " robot=" + Stream.ROBOT_PORT);
        System.out.flush();
        long delay = Long.getLong(BOOT_DELAY_PROPERTY, 0L);
        if (delay > 0) {
            log("robot setup takes %d ms (OpModes and hardware are not ready yet)", delay);
            Thread.sleep(delay);
        }
        registerOpModes();
        SimHardwareMap configured = new SimHardwareMap(simulation.hardware());
        configured.registerDeclared();
        manager.startDefaultOpMode(configured);
        log("%d OpModes registered: %s", opModes.size(), names());
    }

    /**
     * "Restart Robot" on the Driver Station: the Robot Controller stops the OpMode and sets the robot up
     * again with a new event loop, so the {@code @OnCreateEventLoop} hooks run again in the same process
     * while the old stream server still holds port 58080.
     */
    private void restartRobot() {
        log("Driver Station: restart robot");
        simulation.stop();
        VirtualOpModeManager next = VirtualOpModeManager.create(this::stopRequestedByRobotLibrary);
        manager = next;
        RobotHooks.onCreateEventLoop(null, VirtualEventLoop.create(next));
        if (next.listenerCount() != 1 || !listening(Stream.ROBOT_PORT)) {
            throw new IllegalStateException("After a restart the robot library's stream did not come back on port " + Stream.ROBOT_PORT + ".");
        }
        SimHardwareMap configured = new SimHardwareMap(simulation.hardware());
        configured.registerDeclared();
        next.startDefaultOpMode(configured);
        log("robot restarted; streaming on port %d again", Stream.ROBOT_PORT);
    }

    /**
     * Registers the project's OpModes, as the Robot Controller does at startup by scanning its APK. The
     * registry is the desktop stand-in in this harness (see its class comment); the metadata is the SDK's.
     */
    private void registerOpModes() {
        RegisteredOpModes registry = RegisteredOpModes.getInstance();
        for (OpModeCatalog.Entry entry : opModes) registry.register(meta(entry), entry.type);
    }

    private static OpModeMeta meta(OpModeCatalog.Entry entry) {
        OpModeMeta.Builder builder = new OpModeMeta.Builder().setName(entry.name)
                .setFlavor("autonomous".equals(entry.flavor) ? OpModeMeta.Flavor.AUTONOMOUS : OpModeMeta.Flavor.TELEOP);
        if (entry.group != null && !entry.group.isEmpty()) builder.setGroup(entry.group);
        return builder.build();
    }

    private static void requirePortFree(int port) throws IOException {
        try (ServerSocket socket = new ServerSocket()) {
            socket.bind(new InetSocketAddress(port));
        } catch (IOException e) {
            throw new IOException("Port " + port + " is in use. Is another virtual hub, or a robot stream, already running?", e);
        }
    }

    private static boolean listening(int port) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", port), 1000);
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    /** The robot library asked for a stop (an app pressed STOP). The SDK queues it; so does this. */
    private void stopRequestedByRobotLibrary() {
        log("stop requested over the robot stream");
        Thread stopper = new Thread(() -> {
            try {
                simulation.stop();
            } catch (RuntimeException e) {
                log("stop failed: %s", e);
            }
        }, "virtual-hub-stop");
        stopper.setDaemon(true);
        stopper.start();
    }

    // Driver Station channel.

    private List<String> greeting() {
        Map<String, Object> hello = Json.object();
        hello.put("protocol", Stream.PROTOCOL_VERSION);
        hello.put("source", "driver-station");
        hello.put("library", Stream.libraryVersion());
        hello.put("robotPort", Stream.ROBOT_PORT);
        DrivetrainDiscovery.Drivetrain names = simulation.drivetrain();
        Map<String, Object> drivetrain = Json.object();
        drivetrain.put("motors", Arrays.asList(names.frontLeft, names.frontRight, names.backLeft, names.backRight));
        drivetrain.put("localizer", names.pinpoint);
        drivetrain.put("source", names.source);
        hello.put("drivetrain", drivetrain);
        List<String> messages = new ArrayList<>();
        messages.add(Stream.encode("hello", hello));
        messages.add(Stream.encode("manifest", manifest()));
        messages.add(lifecycle(simulation.opModeName(), simulation.phase()));
        return messages;
    }

    private Map<String, Object> manifest() {
        List<Object> list = new ArrayList<>();
        for (OpModeCatalog.Entry entry : opModes) {
            Map<String, Object> item = Json.object();
            item.put("name", entry.name);
            item.put("group", entry.group);
            item.put("flavor", entry.flavor);
            list.add(item);
        }
        List<Object> devices = new ArrayList<>();
        SimHardware hardware = simulation.hardware();
        for (String name : hardware.devices().keySet()) {
            Map<String, Object> device = Json.object();
            device.put("name", name);
            device.put("type", hardware.typeOf(name));
            devices.add(device);
        }
        Map<String, Object> body = Json.object();
        body.put("devices", devices);
        body.put("opModes", list);
        return body;
    }

    @SuppressWarnings("unchecked")
    private String onCommand(Map<String, Object> message) {
        String type = Json.string(message, "type", "");
        switch (type) {
            case "init": {
                String name = Json.string(message, "opMode", null);
                OpModeCatalog.Entry entry = name == null ? null : OpModeCatalog.find(opModes, name);
                if (entry == null) throw new IllegalArgumentException("No OpMode named \"" + name + "\". Choose one of: " + names());
                OpMode opMode;
                try {
                    opMode = entry.type.getDeclaredConstructor().newInstance();
                } catch (ReflectiveOperationException | LinkageError e) {
                    throw new IllegalArgumentException("Could not create " + entry.type.getName() + ": " + e, e);
                }
                log("Driver Station: INIT %s", entry.name);
                pending = opMode;
                simulation.init(opMode, entry.name);
                return null;
            }
            case "start":
                log("Driver Station: START");
                simulation.start();
                return null;
            case "stop":
                log("Driver Station: STOP");
                simulation.stop();
                return null;
            case "gamepad": {
                int index = (int) Json.number(message, "index", 1);
                Object state = message.get("state");
                simulation.setGamepad(index == 2 ? 2 : 1, GamepadState.fromMessage(state instanceof Map ? (Map<String, Object>) state : null));
                return null;
            }
            case "place":
                simulation.placeRobot(
                        Math.max(0, Math.min(144, Json.number(message, "x", 72))),
                        Math.max(0, Math.min(144, Json.number(message, "y", 72))),
                        Json.number(message, "heading", 0));
                return null;
            case "restart":
                restartRobot();
                return null;
            case "shutdown":
                log("Driver Station: shutdown");
                shutdown.countDown();
                return null;
            default:
                throw new IllegalArgumentException("Unknown Driver Station command \"" + type + "\".");
        }
    }

    private void report() {
        while (!Thread.currentThread().isInterrupted()) {
            if (driverStation.hasClients()) {
                toDriverStation(Stream.encode("robot", truth()));
                List<String> telemetry = simulation.telemetry();
                if (!telemetry.equals(lastTelemetry)) {
                    lastTelemetry = telemetry;
                    Map<String, Object> body = Json.object();
                    body.put("lines", telemetry);
                    toDriverStation(Stream.encode("telemetry", body));
                }
            }
            try {
                Thread.sleep(REPORT_INTERVAL_MS);
            } catch (InterruptedException e) {
                return;
            }
        }
    }

    /** The simulated robot's true state, which no real Driver Station could show. */
    private Map<String, Object> truth() {
        SimHardware.Body body = simulation.robot();
        Map<String, Object> pose = Json.object();
        pose.put("x", round(body.x()));
        pose.put("y", round(body.y()));
        pose.put("heading", round(AngleUnit.normalizeRadians(body.heading())));
        Map<String, Object> result = Json.object();
        result.put("opMode", simulation.opModeName());
        result.put("phase", simulation.phase().name().toLowerCase(Locale.ROOT));
        result.put("elapsed", round(simulation.elapsedSeconds()));
        result.put("pose", pose);
        result.put("voltage", round(body.batteryVolts()));
        result.put("devices", simulation.mechanismOutputs());
        result.put("appConnected", Stream.hasClients());
        result.put("appClients", robotStreamClients());
        return result;
    }

    /** Clients on the robot library's stream server, read from its private field; -1 if unavailable. */
    private static int robotStreamClients() {
        try {
            java.lang.reflect.Field field = RobotHooks.class.getDeclaredField("server");
            field.setAccessible(true);
            Object server = field.get(null);
            return server instanceof StreamServer ? ((StreamServer) server).clientCount() : 0;
        } catch (ReflectiveOperationException | RuntimeException e) {
            return -1;
        }
    }

    private static String lifecycle(String opMode, Simulation.Phase phase) {
        Map<String, Object> body = Json.object();
        body.put("opMode", opMode);
        body.put("phase", phase.name().toLowerCase(Locale.ROOT));
        return Stream.encode("lifecycle", body);
    }

    private static Map<String, Object> errorBody(String opMode, Throwable failure) {
        Map<String, Object> body = Json.object();
        body.put("opMode", opMode);
        body.put("message", failure.getClass().getSimpleName() + (failure.getMessage() == null ? "" : ": " + failure.getMessage()));
        List<Object> frames = new ArrayList<>();
        for (StackTraceElement element : failure.getStackTrace()) {
            if (frames.size() >= 30) break;
            Map<String, Object> frame = Json.object();
            frame.put("class", element.getClassName());
            frame.put("method", element.getMethodName());
            frame.put("file", element.getFileName());
            frame.put("line", element.getLineNumber());
            frames.add(frame);
        }
        body.put("stack", frames);
        return body;
    }

    private void toDriverStation(String message) {
        if (driverStation.hasClients()) driverStation.broadcast(message);
    }

    private String names() {
        List<String> names = new ArrayList<>();
        for (OpModeCatalog.Entry entry : opModes) names.add(entry.name);
        return String.join(", ", names);
    }

    private static double round(double value) {
        return Math.round(value * 1000.0) / 1000.0;
    }

    private static void log(String format, Object... args) {
        System.out.println("[hub] " + String.format(Locale.ROOT, format, args));
        System.out.flush();
    }

    @Override
    public void close() {
        // The Robot Controller's shutdown path: the robot library's @OnDestroy hook.
        if (booted) RobotHooks.onDestroy(null);
        simulation.close();
        driverStation.end();
    }
}
