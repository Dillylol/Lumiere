package dev.lumiere.sim.physics;

/**
 * Physical parameters of the simulated drivetrain. Defaults describe a typical FTC mecanum robot:
 * an 18 inch frame, 104 mm mecanum wheels, and goBILDA 312 RPM motors on a 12.8 V battery.
 */
public final class RobotParameters {
    /** Frame width (left to right) in inches, used for field-wall collisions. */
    public double widthInches = 18;
    /** Frame length (front to back) in inches, used for field-wall collisions. */
    public double lengthInches = 18;
    /** Distance between left and right wheel contact points, in inches. */
    public double trackWidthInches = 14.5;
    /** Distance between front and back wheel contact points, in inches. */
    public double wheelBaseInches = 12.5;
    public double wheelDiameterInches = 104.0 / 25.4;
    public double motorFreeRpm = 312;
    /** Battery voltage at rest. Wheel speed scales with voltage relative to the 12 V motor rating. */
    public double batteryVolts = 12.8;
    /** Voltage drop at full power on all four drive motors. */
    public double batterySagVolts = 0.9;
    /** Lateral speed relative to forward speed for the same wheel power. Mecanum rollers slip. */
    public double strafeEfficiency = 0.85;
    /** Time constant of the robot's speed response to a power change, in seconds. */
    public double responseSeconds = 0.12;
    /** Largest linear acceleration the wheels can transmit, in inches per second squared. */
    public double maxAcceleration = 220;
    /** Deceleration while coasting with zero power and FLOAT, in inches per second squared. */
    public double coastForwardDeceleration = 40;
    public double coastLateralDeceleration = 55;
    /** Time constant of braking with zero power and BRAKE, in seconds. */
    public double brakeSeconds = 0.06;
    /** Field size in inches. The standard FTC field is 12 ft by 12 ft. */
    public double fieldInches = 144;

    /** Free wheel surface speed at the rated 12 V, in inches per second. */
    public double freeWheelSpeed() {
        return motorFreeRpm / 60.0 * Math.PI * wheelDiameterInches;
    }

    public double wheelCircumference() {
        return Math.PI * wheelDiameterInches;
    }

    /** Sum of half the track width and half the wheel base, the mecanum rotation lever arm. */
    public double rotationLever() {
        return (trackWidthInches + wheelBaseInches) / 2.0;
    }

    public RobotParameters copy() {
        RobotParameters copy = new RobotParameters();
        copy.widthInches = widthInches;
        copy.lengthInches = lengthInches;
        copy.trackWidthInches = trackWidthInches;
        copy.wheelBaseInches = wheelBaseInches;
        copy.wheelDiameterInches = wheelDiameterInches;
        copy.motorFreeRpm = motorFreeRpm;
        copy.batteryVolts = batteryVolts;
        copy.batterySagVolts = batterySagVolts;
        copy.strafeEfficiency = strafeEfficiency;
        copy.responseSeconds = responseSeconds;
        copy.maxAcceleration = maxAcceleration;
        copy.coastForwardDeceleration = coastForwardDeceleration;
        copy.coastLateralDeceleration = coastLateralDeceleration;
        copy.brakeSeconds = brakeSeconds;
        copy.fieldInches = fieldInches;
        return copy;
    }
}
