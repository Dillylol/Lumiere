package dev.lumiere.sim;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.SimulatorOpModeAccess;
import com.qualcomm.robotcore.hardware.Gamepad;
import com.qualcomm.robotcore.robocol.TelemetryMessage;

import org.firstinspires.ftc.robotcore.internal.opmode.OpModeServices;

import dev.lumiere.sim.hardware.MotorState;
import dev.lumiere.sim.hardware.ServoState;
import dev.lumiere.sim.hardware.SimHardware;
import dev.lumiere.sim.hardware.SimHardwareMap;
import dev.lumiere.sim.physics.MecanumModel;
import dev.lumiere.sim.physics.RobotParameters;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * One simulated robot running one OpMode through INIT, START, and STOP.
 *
 * <p>Three threads run while the simulation is open: physics at 1 kHz, an event loop at 100 Hz that
 * delivers gamepads and wakes waiting OpModes (as the Robot Controller's event loop does), and the
 * OpMode's own thread created by the SDK lifecycle. All run on wall-clock time.
 */
public final class Simulation implements AutoCloseable {
    public enum Phase { IDLE, INIT, RUNNING, STOPPED }

    /** Receives lifecycle changes and failures. Called from simulator threads. */
    public interface Listener {
        default void onPhase(String opMode, Phase phase) { }

        default void onFailure(String opMode, Throwable failure) { }
    }

    private static final long EVENT_LOOP_MS = 10;

    private final RobotParameters parameters;
    private final DrivetrainDiscovery.Drivetrain drivetrain;
    private final MecanumModel model;
    private final SimHardware hardware;
    private final Gamepad gamepad1 = new Gamepad();
    private final Gamepad gamepad2 = new Gamepad();
    private final Object gamepadLock = new Object();
    private final Listener listener;
    private final Thread physicsThread;
    private final Thread eventLoopThread;

    private volatile SimulatorOpModeAccess access;
    private volatile String opModeName;
    private volatile Phase phase = Phase.IDLE;
    private volatile boolean stopRequestedByOpMode;
    private final java.util.concurrent.atomic.AtomicBoolean stopping = new java.util.concurrent.atomic.AtomicBoolean();
    private volatile boolean closed;
    private volatile Throwable failure;
    private volatile List<String> telemetry = Collections.emptyList();
    private volatile long startedAtMillis;

    public Simulation(RobotParameters parameters, DrivetrainDiscovery.Drivetrain drivetrain, double startX, double startY, double startHeading, Listener listener) {
        this.parameters = parameters.copy();
        this.drivetrain = drivetrain;
        this.listener = listener != null ? listener : new Listener() { };
        this.model = new MecanumModel(parameters, startX, startY, startHeading);
        this.hardware = new SimHardware(model);
        PanelsSupport.prepare();

        MotorState frontLeft = hardware.declareMotor(drivetrain.frontLeft);
        MotorState frontRight = hardware.declareMotor(drivetrain.frontRight);
        MotorState backLeft = hardware.declareMotor(drivetrain.backLeft);
        MotorState backRight = hardware.declareMotor(drivetrain.backRight);
        frontLeft.setMountSign(sign(drivetrain.frontLeftDirection));
        frontRight.setMountSign(sign(drivetrain.frontRightDirection));
        backLeft.setMountSign(sign(drivetrain.backLeftDirection));
        backRight.setMountSign(sign(drivetrain.backRightDirection));
        model.setDriveMotors(frontLeft, frontRight, backLeft, backRight);
        if (drivetrain.pinpoint != null) hardware.declare(com.qualcomm.hardware.gobilda.GoBildaPinpointDriver.class, drivetrain.pinpoint);

        physicsThread = new Thread(this::runPhysics, "sim-physics");
        physicsThread.setDaemon(true);
        physicsThread.start();
        eventLoopThread = new Thread(this::runEventLoop, "sim-event-loop");
        eventLoopThread.setDaemon(true);
        eventLoopThread.start();
    }

    private static int sign(com.qualcomm.robotcore.hardware.DcMotorSimple.Direction direction) {
        return direction == com.qualcomm.robotcore.hardware.DcMotorSimple.Direction.REVERSE ? -1 : 1;
    }

    /** Equivalent to selecting an OpMode and pressing INIT. Stops the current OpMode first. */
    public synchronized void init(OpMode opMode, String name) {
        if (closed) throw new IllegalStateException("The simulation is closed.");
        stopInternal();
        failure = null;
        stopRequestedByOpMode = false;
        telemetry = Collections.emptyList();
        opModeName = name;
        SimHardwareMap hardwareMap = new SimHardwareMap(hardware);
        hardwareMap.registerDeclared();
        SimulatorOpModeAccess next = new SimulatorOpModeAccess(opMode);
        next.init(hardwareMap, new Services());
        access = next;
        setPhase(Phase.INIT);
    }

    /** Equivalent to pressing START. */
    public synchronized void start() {
        SimulatorOpModeAccess current = access;
        if (current == null || phase != Phase.INIT) throw new IllegalStateException("Press INIT before START.");
        startedAtMillis = System.currentTimeMillis();
        current.start();
        setPhase(Phase.RUNNING);
    }

    /** Equivalent to pressing STOP. Safe to call in any phase. */
    public synchronized void stop() {
        stopInternal();
    }

    private void stopInternal() {
        SimulatorOpModeAccess current = access;
        if (current == null) return;
        access = null;
        SimulatorOpModeAccess.StopResult result = current.stop();
        if (result != SimulatorOpModeAccess.StopResult.STOPPED && failure == null) {
            failure = new IllegalStateException(result == SimulatorOpModeAccess.StopResult.STUCK
                    ? "The OpMode is still running after STOP. A loop is ignoring opModeIsActive(); restart the simulator."
                    : "The OpMode did not stop within one second and was interrupted. Check loops for opModeIsActive() or isStopRequested().");
            listener.onFailure(opModeName, failure);
        }
        for (MotorState motor : hardware.motors()) {
            // The Robot Controller sets motor power to zero when an OpMode ends.
            motor.cutPower();
        }
        setPhase(Phase.STOPPED);
    }

    /** Places the robot, as a team would before pressing INIT. Only allowed while no OpMode runs. */
    public synchronized void placeRobot(double x, double y, double heading) {
        if (phase == Phase.INIT || phase == Phase.RUNNING) throw new IllegalStateException("Stop the OpMode before moving the robot.");
        model.halt();
        model.teleport(x, y, heading);
    }

    /** Replaces a gamepad's state. Index is 1 or 2. */
    public void setGamepad(int index, GamepadState state) {
        synchronized (gamepadLock) {
            state.applyTo(index == 2 ? gamepad2 : gamepad1);
        }
    }

    public Phase phase() {
        return phase;
    }

    public String opModeName() {
        return opModeName;
    }

    public Throwable failure() {
        return failure;
    }

    /** Telemetry lines as the Driver Station would show them. */
    public List<String> telemetry() {
        return telemetry;
    }

    /** Seconds since START, or 0 before START. */
    public double elapsedSeconds() {
        return phase == Phase.RUNNING ? (System.currentTimeMillis() - startedAtMillis) / 1000.0 : 0;
    }

    public MecanumModel robot() {
        return model;
    }

    public SimHardware hardware() {
        return hardware;
    }

    public DrivetrainDiscovery.Drivetrain drivetrain() {
        return drivetrain;
    }

    public RobotParameters parameters() {
        return parameters.copy();
    }

    /** Servo and motor outputs for display, keyed by device name. */
    public Map<String, Object> mechanismOutputs() {
        Map<String, Object> outputs = new TreeMap<>();
        for (MotorState motor : hardware.motors()) {
            Map<String, Object> entry = new TreeMap<>();
            entry.put("type", "motor");
            entry.put("power", round(motor.power()));
            entry.put("position", motor.currentPosition());
            outputs.put(motor.name, entry);
        }
        for (ServoState servo : hardware.servos()) {
            Map<String, Object> entry = new TreeMap<>();
            entry.put("type", servo.continuous ? "crservo" : "servo");
            if (servo.continuous) entry.put("power", round(servo.power()));
            else entry.put("position", Double.isNaN(servo.position()) ? null : round(servo.position()));
            outputs.put(servo.name, entry);
        }
        return outputs;
    }

    private static double round(double value) {
        return Math.round(value * 1000.0) / 1000.0;
    }

    @Override
    public void close() {
        synchronized (this) {
            closed = true;
            stopInternal();
        }
        physicsThread.interrupt();
        eventLoopThread.interrupt();
    }

    private void setPhase(Phase next) {
        phase = next;
        listener.onPhase(opModeName, next);
    }

    private void runPhysics() {
        long last = System.nanoTime();
        while (!closed && !Thread.currentThread().isInterrupted()) {
            long now = System.nanoTime();
            double seconds = Math.min((now - last) / 1e9, 0.02);
            last = now;
            model.step(seconds);
            hardware.step(seconds);
            try {
                Thread.sleep(1);
            } catch (InterruptedException e) {
                return;
            }
        }
    }

    private void runEventLoop() {
        Gamepad copy1 = new Gamepad();
        Gamepad copy2 = new Gamepad();
        while (!closed && !Thread.currentThread().isInterrupted()) {
            SimulatorOpModeAccess current = access;
            if (current != null) {
                synchronized (gamepadLock) {
                    copy1.copy(gamepad1);
                    copy2.copy(gamepad2);
                }
                try {
                    current.iterate(copy1, copy2);
                } catch (RuntimeException | LinkageError e) {
                    reportFailure(e);
                }
                if ((stopRequestedByOpMode || failure != null) && stopping.compareAndSet(false, true)) {
                    stopRequestedByOpMode = false;
                    Thread stopper = new Thread(() -> {
                        try {
                            stop();
                        } finally {
                            stopping.set(false);
                        }
                    }, "sim-stop");
                    stopper.setDaemon(true);
                    stopper.start();
                }
            }
            try {
                Thread.sleep(EVENT_LOOP_MS);
            } catch (InterruptedException e) {
                return;
            }
        }
    }

    private void reportFailure(Throwable error) {
        if (failure != null) return;
        failure = error;
        listener.onFailure(opModeName, error);
    }

    private final class Services implements OpModeServices {
        @Override
        public void refreshUserTelemetry(TelemetryMessage message, double sInterval) {
            Map<String, String> lines = new TreeMap<>(message.getDataStrings());
            telemetry = Collections.unmodifiableList(new ArrayList<>(lines.values()));
        }

        @Override
        public void requestOpModeStop(OpMode opModeToStopIfActive) {
            stopRequestedByOpMode = true;
        }
    }
}
