package dev.lumiere.sim;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;

import java.util.List;
import java.util.function.Consumer;

/**
 * Runs an OpMode in the simulator without the app, for automated tests in a robot project.
 *
 * <pre>{@code
 * HeadlessRun.Result result = HeadlessRun.of(ExampleAuto.class).seconds(15).run();
 * assertNull(result.failure);
 * assertEquals(36, result.x, 2);
 * }</pre>
 */
public final class HeadlessRun {
    /** The robot's final state after a run. */
    public static final class Result {
        public final double x;
        public final double y;
        public final double headingDegrees;
        public final List<String> telemetry;
        /** An exception thrown by the OpMode, or null. */
        public final Throwable failure;

        Result(double x, double y, double headingDegrees, List<String> telemetry, Throwable failure) {
            this.x = x;
            this.y = y;
            this.headingDegrees = headingDegrees;
            this.telemetry = telemetry;
            this.failure = failure;
        }

        @Override
        public String toString() {
            return String.format(java.util.Locale.ROOT, "x=%.2f y=%.2f heading=%.1f° failure=%s telemetry=%s", x, y, headingDegrees, failure, telemetry);
        }
    }

    private final Class<? extends OpMode> type;
    private SimulatorConfig config = new SimulatorConfig();
    private double initSeconds = 0.5;
    private double runSeconds = 30;
    private Consumer<Simulation> script = simulation -> { };

    private HeadlessRun(Class<? extends OpMode> type) {
        this.type = type;
    }

    public static HeadlessRun of(Class<? extends OpMode> type) {
        return new HeadlessRun(type);
    }

    public HeadlessRun config(SimulatorConfig config) {
        this.config = config;
        return this;
    }

    /** How long to stay in INIT before pressing START. */
    public HeadlessRun initSeconds(double seconds) {
        this.initSeconds = seconds;
        return this;
    }

    /** Longest time to run after START. The run ends earlier if the OpMode stops itself. */
    public HeadlessRun seconds(double seconds) {
        this.runSeconds = seconds;
        return this;
    }

    /** Called about every 10 ms after START, for example to press gamepad buttons. */
    public HeadlessRun during(Consumer<Simulation> script) {
        this.script = script;
        return this;
    }

    public Result run() throws InterruptedException {
        OpModeCatalog.Entry entry = OpModeCatalog.entryFor(type);
        String name = entry != null ? entry.name : type.getSimpleName();
        DrivetrainDiscovery.Drivetrain drivetrain = DrivetrainDiscovery.discover(config.constantsClass);
        try (Simulation simulation = new Simulation(config.robot, drivetrain, config.startX, config.startY, config.startHeading, null)) {
            for (SimulatorConfig.Device device : config.devices) simulation.hardware().declare(device.type, device.name);
            OpMode opMode;
            try {
                opMode = type.getDeclaredConstructor().newInstance();
            } catch (ReflectiveOperationException e) {
                throw new IllegalArgumentException("OpModes need a public no-argument constructor: " + type.getName(), e);
            }
            simulation.init(opMode, name);
            sleep(initSeconds);
            if (simulation.phase() == Simulation.Phase.INIT && simulation.failure() == null) {
                simulation.start();
                long end = System.currentTimeMillis() + (long) (runSeconds * 1000);
                while (System.currentTimeMillis() < end && simulation.phase() == Simulation.Phase.RUNNING && simulation.failure() == null) {
                    script.accept(simulation);
                    Thread.sleep(10);
                }
            }
            simulation.stop();
            return new Result(simulation.robot().x(), simulation.robot().y(),
                    Math.toDegrees(org.firstinspires.ftc.robotcore.external.navigation.AngleUnit.normalizeRadians(simulation.robot().heading())),
                    simulation.telemetry(), simulation.failure());
        }
    }

    private static void sleep(double seconds) throws InterruptedException {
        Thread.sleep((long) (seconds * 1000));
    }
}
