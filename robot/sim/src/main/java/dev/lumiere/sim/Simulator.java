package dev.lumiere.sim;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;

import dev.lumiere.ftc.Manifest;
import dev.lumiere.ftc.Stream;
import dev.lumiere.ftc.internal.Json;
import dev.lumiere.ftc.internal.StreamServer;
import dev.lumiere.sim.hardware.SimHardware;

import java.io.IOException;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * The interactive simulator: a {@link Simulation} controlled by the app over the stream protocol.
 *
 * <p>It binds only to 127.0.0.1 and requires the token passed on the command line. The app starts it
 * through the robot project's unit-test task, which sets these system properties:
 * <ul>
 *   <li>{@value #PORT_PROPERTY}: the WebSocket port</li>
 *   <li>{@value #TOKEN_ENVIRONMENT} environment variable (or {@value #TOKEN_PROPERTY}): the token the app must send first</li>
 *   <li>{@value #CONFIG_PROPERTY}: optional path to a JSON configuration</li>
 * </ul>
 */
public final class Simulator {
    public static final String PORT_PROPERTY = "sim.port";
    public static final String TOKEN_PROPERTY = "sim.token";
    public static final String TOKEN_ENVIRONMENT = "SIM_TOKEN";
    public static final String CONFIG_PROPERTY = "sim.config";
    /** Printed to standard output once the server accepts connections. */
    public static final String READY_LINE = "SIMULATOR_READY";

    private static final long REPORT_INTERVAL_MS = 33;
    private static final long NO_CLIENT_TIMEOUT_MS = 60_000;

    private final SimulatorConfig config;
    private final List<OpModeCatalog.Entry> opModes;
    private final Simulation simulation;
    private final StreamServer server;
    private final CountDownLatch shutdown = new CountDownLatch(1);
    private volatile List<String> lastTelemetry = new ArrayList<>();

    public Simulator(String hostname, int port, String token, SimulatorConfig config) {
        this.config = config;
        this.opModes = OpModeCatalog.scan(config.packagePrefix);
        DrivetrainDiscovery.Drivetrain drivetrain = DrivetrainDiscovery.discover(config.constantsClass);
        this.simulation = new Simulation(config.robot, drivetrain, config.startX, config.startY, config.startHeading, new Simulation.Listener() {
            @Override
            public void onPhase(String opMode, Simulation.Phase phase) {
                Map<String, Object> body = Json.object();
                body.put("opMode", opMode);
                body.put("phase", phase.name().toLowerCase(java.util.Locale.ROOT));
                Stream.publish("lifecycle", body);
            }

            @Override
            public void onFailure(String opMode, Throwable failure) {
                Stream.publish("error", errorBody(opMode, failure));
            }
        });
        for (SimulatorConfig.Device device : config.devices) {
            simulation.hardware().declare(device.type, device.name);
        }
        this.server = new StreamServer(hostname, port, token, this::greeting, this::onMessage);
    }

    /** True when the unit-test task was asked to launch the simulator. */
    public static boolean isRequested() {
        return System.getProperty(PORT_PROPERTY) != null;
    }

    /** Runs the simulator from system properties until the app sends {@code shutdown} or disconnects. */
    public static void runFromSystemProperties() throws IOException, InterruptedException {
        int port = Integer.parseInt(System.getProperty(PORT_PROPERTY));
        // The app passes the token in the environment so it does not appear in process listings.
        String token = System.getenv(TOKEN_ENVIRONMENT);
        if (token == null || token.isEmpty()) token = System.getProperty(TOKEN_PROPERTY);
        if (token == null || token.length() < 16) throw new IllegalArgumentException("A token of at least 16 characters is required.");
        String configPath = System.getProperty(CONFIG_PROPERTY);
        SimulatorConfig config = SimulatorConfig.load(configPath == null || configPath.isEmpty() ? null : Paths.get(configPath));
        new Simulator("127.0.0.1", port, token, config).run();
    }

    public void run() throws IOException, InterruptedException {
        server.begin();
        Stream.install(server);
        Thread reporter = new Thread(this::report, "sim-report");
        reporter.setDaemon(true);
        reporter.start();
        System.out.println(READY_LINE + " " + server.getListeningPort());
        System.out.flush();
        long lastClientSeen = System.currentTimeMillis();
        try {
            while (!shutdown.await(1, TimeUnit.SECONDS)) {
                if (server.hasClients()) lastClientSeen = System.currentTimeMillis();
                else if (System.currentTimeMillis() - lastClientSeen > NO_CLIENT_TIMEOUT_MS) break;
            }
        } finally {
            reporter.interrupt();
            simulation.close();
            Stream.uninstall(server);
            server.end();
        }
    }

    public Simulation simulation() {
        return simulation;
    }

    private List<String> greeting() {
        Map<String, Object> hello = Json.object();
        hello.put("protocol", Stream.PROTOCOL_VERSION);
        hello.put("source", "simulator");
        hello.put("library", Stream.libraryVersion());
        Map<String, Object> drivetrain = Json.object();
        DrivetrainDiscovery.Drivetrain names = simulation.drivetrain();
        drivetrain.put("motors", Arrays.asList(names.frontLeft, names.frontRight, names.backLeft, names.backRight));
        drivetrain.put("localizer", names.pinpoint);
        drivetrain.put("source", names.source);
        hello.put("drivetrain", drivetrain);
        Map<String, Object> robot = Json.object();
        robot.put("widthInches", config.robot.widthInches);
        robot.put("lengthInches", config.robot.lengthInches);
        hello.put("robot", robot);

        List<String> messages = new ArrayList<>();
        messages.add(Stream.encode("hello", hello));
        messages.add(Stream.encode("manifest", manifest()));
        Map<String, Object> lifecycle = Json.object();
        lifecycle.put("opMode", simulation.opModeName());
        lifecycle.put("phase", simulation.phase().name().toLowerCase(java.util.Locale.ROOT));
        messages.add(Stream.encode("lifecycle", lifecycle));
        return messages;
    }

    private Map<String, Object> manifest() {
        List<Manifest.OpModeInfo> infos = new ArrayList<>();
        for (OpModeCatalog.Entry entry : opModes) infos.add(new Manifest.OpModeInfo(entry.name, entry.group, entry.flavor));
        Map<String, Object> body = Manifest.build(null, infos);
        List<Object> devices = new ArrayList<>();
        SimHardware hardware = simulation.hardware();
        for (String name : hardware.devices().keySet()) {
            Map<String, Object> device = Json.object();
            device.put("name", name);
            device.put("type", hardware.typeOf(name));
            devices.add(device);
        }
        body.put("devices", devices);
        return body;
    }

    @SuppressWarnings("unchecked")
    private String onMessage(Map<String, Object> message) {
        String type = Json.string(message, "type", "");
        switch (type) {
            case "init": {
                String name = Json.string(message, "opMode", null);
                OpModeCatalog.Entry entry = name == null ? null : OpModeCatalog.find(opModes, name);
                if (entry == null) throw new IllegalArgumentException("No OpMode named \"" + name + "\" was found.");
                OpMode opMode;
                try {
                    opMode = entry.type.getDeclaredConstructor().newInstance();
                } catch (ReflectiveOperationException | LinkageError e) {
                    throw new IllegalArgumentException("Could not create " + entry.type.getName() + ": " + e, e);
                }
                simulation.init(opMode, entry.name);
                return null;
            }
            case "start":
                simulation.start();
                return null;
            case "stop":
                simulation.stop();
                return null;
            case "gamepad": {
                int index = (int) Json.number(message, "index", 1);
                Object state = message.get("state");
                simulation.setGamepad(index, GamepadState.fromMessage(state instanceof Map ? (Map<String, Object>) state : null));
                return null;
            }
            case "place":
                simulation.placeRobot(
                        Math.max(0, Math.min(144, Json.number(message, "x", 72))),
                        Math.max(0, Math.min(144, Json.number(message, "y", 72))),
                        Json.number(message, "heading", 0));
                return null;
            case "shutdown":
                shutdown.countDown();
                return null;
            default:
                throw new IllegalArgumentException("Unknown message type \"" + type + "\".");
        }
    }

    private void report() {
        while (!Thread.currentThread().isInterrupted()) {
            if (server.hasClients()) {
                Stream.publish("robot", robotBody());
                List<String> telemetry = simulation.telemetry();
                if (!telemetry.equals(lastTelemetry)) {
                    lastTelemetry = telemetry;
                    Map<String, Object> body = Json.object();
                    body.put("lines", telemetry);
                    Stream.publish("telemetry", body);
                }
            }
            try {
                Thread.sleep(REPORT_INTERVAL_MS);
            } catch (InterruptedException e) {
                return;
            }
        }
    }

    Map<String, Object> robotBody() {
        SimHardware.Body body = simulation.robot();
        Map<String, Object> pose = Json.object();
        pose.put("x", round(body.x()));
        pose.put("y", round(body.y()));
        pose.put("heading", round(org.firstinspires.ftc.robotcore.external.navigation.AngleUnit.normalizeRadians(body.heading())));
        Map<String, Object> velocity = Json.object();
        velocity.put("x", round(body.vx()));
        velocity.put("y", round(body.vy()));
        velocity.put("heading", round(body.omega()));
        Map<String, Object> result = Json.object();
        result.put("opMode", simulation.opModeName());
        result.put("phase", simulation.phase().name().toLowerCase(java.util.Locale.ROOT));
        result.put("elapsed", round(simulation.elapsedSeconds()));
        result.put("pose", pose);
        result.put("velocity", velocity);
        result.put("voltage", round(body.batteryVolts()));
        result.put("devices", simulation.mechanismOutputs());
        return result;
    }

    static Map<String, Object> errorBody(String opMode, Throwable failure) {
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

    private static double round(double value) {
        return Math.round(value * 1000.0) / 1000.0;
    }
}
