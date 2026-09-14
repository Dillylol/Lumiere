package dev.lumiere.sim.hardware;

import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorSimple;

/**
 * The simulated state of one DC motor.
 *
 * <p>Drive motors are moved by the drivetrain model, which sets {@link #wheelTravelInches}. Other
 * motors spin freely with a first-order speed response and, in RUN_TO_POSITION, a simple
 * position controller like the one in the REV hub firmware.
 */
public final class MotorState {
    /** goBILDA 5203 series 312 RPM gearmotor, a common FTC drivetrain motor. */
    public static final double DEFAULT_TICKS_PER_REV = 537.7;
    public static final double DEFAULT_FREE_RPM = 312.0;
    private static final double RESPONSE_SECONDS = 0.08;
    private static final int POSITION_TOLERANCE = 10;
    private static final double POSITION_GAIN_PER_SECOND = 6.0;

    public final String name;
    public final double ticksPerRev;
    public final double freeRpm;

    volatile double power;
    volatile DcMotorSimple.Direction direction = DcMotorSimple.Direction.FORWARD;
    volatile DcMotor.ZeroPowerBehavior zeroPowerBehavior = DcMotor.ZeroPowerBehavior.FLOAT;
    volatile DcMotor.RunMode mode = DcMotor.RunMode.RUN_WITHOUT_ENCODER;
    volatile int targetPosition;
    volatile int targetTolerance = POSITION_TOLERANCE;
    volatile boolean enabled = true;

    /** Set by the drivetrain model for drive motors; null for free-spinning motors. */
    volatile Double wheelTravelInches;
    /**
     * +1 when positive shaft rotation moves the robot forward, -1 when the motor is mounted mirrored.
     * The simulator assumes the robot is wired the way its drivetrain constants describe.
     */
    volatile int mountSign = 1;

    private double shaftTicks;
    private double shaftTicksPerSecond;
    private int encoderOffset;

    public MotorState(String name) {
        this(name, DEFAULT_TICKS_PER_REV, DEFAULT_FREE_RPM);
    }

    public MotorState(String name, double ticksPerRev, double freeRpm) {
        this.name = name;
        this.ticksPerRev = ticksPerRev;
        this.freeRpm = freeRpm;
    }

    /** Power in the direction the motor physically turns, after applying its configured direction. */
    public double appliedPower() {
        if (!enabled) return 0;
        double sign = direction == DcMotorSimple.Direction.REVERSE ? -1 : 1;
        return clamp(effectivePower()) * sign;
    }

    private double effectivePower() {
        if (mode != DcMotor.RunMode.RUN_TO_POSITION) return power;
        // Like the hub firmware, keep driving toward the target: request a speed proportional to the
        // remaining error, limited by the power the OpMode set. This settles without coasting past.
        int error = targetPosition - currentPosition();
        double maxTicksPerSecond = freeRpm / 60.0 * ticksPerRev;
        double requested = error * POSITION_GAIN_PER_SECOND / maxTicksPerSecond;
        double limit = Math.abs(power);
        return Math.max(-limit, Math.min(limit, requested));
    }

    public double power() {
        return power;
    }

    /** Sets the commanded power to zero, as the Robot Controller does when an OpMode stops. */
    public void cutPower() {
        power = 0;
    }

    public DcMotor.ZeroPowerBehavior zeroPowerBehavior() {
        return zeroPowerBehavior;
    }

    public DcMotorSimple.Direction direction() {
        return direction;
    }

    public DcMotor.RunMode mode() {
        return mode;
    }

    /** Advances a free-spinning motor. Drive motors are advanced by the drivetrain model instead. */
    synchronized void step(double seconds) {
        if (wheelTravelInches != null) return;
        double maxTicksPerSecond = freeRpm / 60.0 * ticksPerRev;
        double target = appliedPower() * maxTicksPerSecond;
        if (Math.abs(appliedPower()) < 1e-6 && zeroPowerBehavior == DcMotor.ZeroPowerBehavior.BRAKE) {
            shaftTicksPerSecond *= Math.exp(-seconds / (RESPONSE_SECONDS / 3));
        } else {
            shaftTicksPerSecond += (target - shaftTicksPerSecond) * (1 - Math.exp(-seconds / RESPONSE_SECONDS));
        }
        shaftTicks += shaftTicksPerSecond * seconds;
    }

    /** Power pushing the wheel forward, used by the drivetrain model. */
    public double wheelPower() {
        return appliedPower() * mountSign;
    }

    /** Marks this motor as a drive wheel. See {@link #mountSign}. */
    public void setMountSign(int sign) {
        mountSign = sign < 0 ? -1 : 1;
    }

    /** Called by the drivetrain model with the wheel's forward travel and speed. */
    public synchronized void applyWheelMotion(double travelInches, double inchesPerSecond, double circumferenceInches) {
        wheelTravelInches = travelInches;
        shaftTicks = travelInches / circumferenceInches * ticksPerRev * mountSign;
        shaftTicksPerSecond = inchesPerSecond / circumferenceInches * ticksPerRev * mountSign;
    }

    /** The encoder count as reported by the SDK, which follows the configured direction. */
    public synchronized int currentPosition() {
        double sign = direction == DcMotorSimple.Direction.REVERSE ? -1 : 1;
        return (int) Math.round(shaftTicks * sign) - encoderOffset;
    }

    public synchronized double velocityTicksPerSecond() {
        double sign = direction == DcMotorSimple.Direction.REVERSE ? -1 : 1;
        return shaftTicksPerSecond * sign;
    }

    synchronized void setMode(DcMotor.RunMode newMode) {
        if (newMode == DcMotor.RunMode.STOP_AND_RESET_ENCODER) {
            encoderOffset += currentPosition();
            power = 0;
        }
        mode = newMode;
    }

    boolean isBusy() {
        return mode == DcMotor.RunMode.RUN_TO_POSITION && Math.abs(targetPosition - currentPosition()) > targetTolerance;
    }

    private static double clamp(double value) {
        return Math.max(-1, Math.min(1, value));
    }
}
