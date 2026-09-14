package dev.lumiere.sim.physics;

import com.qualcomm.robotcore.hardware.DcMotor;

import dev.lumiere.sim.hardware.MotorState;
import dev.lumiere.sim.hardware.SimHardware;

/**
 * A planar mecanum drivetrain model in Pedro Pathing field coordinates (inches, radians, origin at
 * the bottom-left corner, heading 0 along +x).
 *
 * <p>Wheel powers set a target body velocity through standard mecanum kinematics. The body approaches
 * it with a first-order response limited by traction, coasts or brakes according to the motors'
 * zero-power behavior, and stops at the field walls. The model is deliberately simple: it is meant to
 * exercise real OpMode code, not to predict a specific robot's behavior.
 */
public final class MecanumModel implements SimHardware.Body {
    private static final double ZERO_POWER = 0.005;

    private final RobotParameters parameters;
    private MotorState frontLeft;
    private MotorState frontRight;
    private MotorState backLeft;
    private MotorState backRight;

    private double x;
    private double y;
    private double heading;
    /** Body-frame velocity: forward, left, and counterclockwise. */
    private double forwardVelocity;
    private double leftVelocity;
    private double angularVelocity;
    private final double[] wheelTravel = new double[4];
    private double volts;

    public MecanumModel(RobotParameters parameters, double x, double y, double heading) {
        this.parameters = parameters.copy();
        this.x = x;
        this.y = y;
        this.heading = heading;
        this.volts = parameters.batteryVolts;
    }

    public RobotParameters parameters() {
        return parameters.copy();
    }

    /** Connects the four drive motors. Any of them may be null if the robot does not declare it. */
    public synchronized void setDriveMotors(MotorState frontLeft, MotorState frontRight, MotorState backLeft, MotorState backRight) {
        this.frontLeft = frontLeft;
        this.frontRight = frontRight;
        this.backLeft = backLeft;
        this.backRight = backRight;
    }

    public synchronized void step(double seconds) {
        if (seconds <= 0) return;
        MotorState[] motors = {frontLeft, frontRight, backLeft, backRight};
        double[] power = new double[4];
        int braking = 0;
        double totalPower = 0;
        double largest = 0;
        for (int i = 0; i < 4; i++) {
            if (motors[i] == null) continue;
            power[i] = motors[i].wheelPower();
            totalPower += Math.abs(power[i]);
            largest = Math.max(largest, Math.abs(power[i]));
            if (motors[i].zeroPowerBehavior() == DcMotor.ZeroPowerBehavior.BRAKE) braking++;
        }

        volts = parameters.batteryVolts - parameters.batterySagVolts * totalPower / 4.0;
        double lever = parameters.rotationLever();

        if (largest < ZERO_POWER) {
            if (braking >= 2) {
                double decay = Math.exp(-seconds / parameters.brakeSeconds);
                forwardVelocity *= decay;
                leftVelocity *= decay;
                angularVelocity *= decay;
            } else {
                forwardVelocity = towardZero(forwardVelocity, parameters.coastForwardDeceleration * seconds);
                leftVelocity = towardZero(leftVelocity, parameters.coastLateralDeceleration * seconds);
                angularVelocity = towardZero(angularVelocity, parameters.coastForwardDeceleration / lever * seconds);
            }
        } else {
            double speed = parameters.freeWheelSpeed() * volts / 12.0;
            double targetForward = speed * (power[0] + power[1] + power[2] + power[3]) / 4.0;
            double targetLeft = speed * (-power[0] + power[1] + power[2] - power[3]) / 4.0 * parameters.strafeEfficiency;
            double targetAngular = speed * (-power[0] + power[1] - power[2] + power[3]) / (4.0 * lever);

            double blend = 1 - Math.exp(-seconds / parameters.responseSeconds);
            double deltaForward = (targetForward - forwardVelocity) * blend;
            double deltaLeft = (targetLeft - leftVelocity) * blend;
            double deltaAngular = (targetAngular - angularVelocity) * blend;

            double maxLinear = parameters.maxAcceleration * seconds;
            double linear = Math.hypot(deltaForward, deltaLeft);
            if (linear > maxLinear) {
                deltaForward *= maxLinear / linear;
                deltaLeft *= maxLinear / linear;
            }
            double maxAngular = parameters.maxAcceleration / lever * seconds;
            deltaAngular = Math.max(-maxAngular, Math.min(maxAngular, deltaAngular));

            forwardVelocity += deltaForward;
            leftVelocity += deltaLeft;
            angularVelocity += deltaAngular;
        }

        double midHeading = heading + angularVelocity * seconds / 2.0;
        double cos = Math.cos(midHeading);
        double sin = Math.sin(midHeading);
        x += (forwardVelocity * cos - leftVelocity * sin) * seconds;
        y += (forwardVelocity * sin + leftVelocity * cos) * seconds;
        heading += angularVelocity * seconds;
        collideWithWalls();
        updateEncoders(motors, seconds, lever);
    }

    private void collideWithWalls() {
        double cos = Math.abs(Math.cos(heading));
        double sin = Math.abs(Math.sin(heading));
        double halfX = (cos * parameters.lengthInches + sin * parameters.widthInches) / 2.0;
        double halfY = (sin * parameters.lengthInches + cos * parameters.widthInches) / 2.0;
        double field = parameters.fieldInches;
        double vx = vxUnsynchronized();
        double vy = vyUnsynchronized();
        boolean hit = false;
        if (x < halfX) { x = halfX; vx = Math.max(0, vx); hit = true; }
        if (x > field - halfX) { x = field - halfX; vx = Math.min(0, vx); hit = true; }
        if (y < halfY) { y = halfY; vy = Math.max(0, vy); hit = true; }
        if (y > field - halfY) { y = field - halfY; vy = Math.min(0, vy); hit = true; }
        if (hit) {
            double c = Math.cos(heading);
            double s = Math.sin(heading);
            forwardVelocity = vx * c + vy * s;
            leftVelocity = -vx * s + vy * c;
        }
    }

    private void updateEncoders(MotorState[] motors, double seconds, double lever) {
        double lateral = leftVelocity / parameters.strafeEfficiency;
        double rotation = angularVelocity * lever;
        double[] wheelSpeed = {
                forwardVelocity - lateral - rotation,
                forwardVelocity + lateral + rotation,
                forwardVelocity + lateral - rotation,
                forwardVelocity - lateral + rotation,
        };
        for (int i = 0; i < 4; i++) {
            wheelTravel[i] += wheelSpeed[i] * seconds;
            if (motors[i] != null) {
                motors[i].applyWheelMotion(wheelTravel[i], wheelSpeed[i], parameters.wheelCircumference());
            }
        }
    }

    private static double towardZero(double value, double amount) {
        if (value > 0) return Math.max(0, value - amount);
        return Math.min(0, value + amount);
    }

    private double vxUnsynchronized() {
        return forwardVelocity * Math.cos(heading) - leftVelocity * Math.sin(heading);
    }

    private double vyUnsynchronized() {
        return forwardVelocity * Math.sin(heading) + leftVelocity * Math.cos(heading);
    }

    @Override public synchronized double x() { return x; }
    @Override public synchronized double y() { return y; }
    @Override public synchronized double heading() { return heading; }
    @Override public synchronized double vx() { return vxUnsynchronized(); }
    @Override public synchronized double vy() { return vyUnsynchronized(); }
    @Override public synchronized double omega() { return angularVelocity; }
    @Override public synchronized double batteryVolts() { return volts; }

    @Override
    public synchronized void teleport(double x, double y, double heading) {
        this.x = x;
        this.y = y;
        this.heading = heading;
    }

    /** Stops the robot where it is, as if picked up and set down. */
    public synchronized void halt() {
        forwardVelocity = 0;
        leftVelocity = 0;
        angularVelocity = 0;
    }
}
