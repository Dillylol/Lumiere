package dev.lumiere.sim.hardware;

import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.robotcore.hardware.I2cDeviceSynchSimple;

import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.Pose2D;
import org.firstinspires.ftc.robotcore.external.navigation.UnnormalizedAngleUnit;

import java.lang.reflect.Proxy;

/**
 * A goBILDA Pinpoint that reports the simulated robot's true pose.
 *
 * <p>Pod offsets, directions, and resolution are accepted and ignored: in simulation the odometry is
 * exact. Setting the position moves the simulated robot, which is how an OpMode's starting pose
 * places the robot on the field.
 */
public final class SimPinpoint extends GoBildaPinpointDriver {
    private final SimHardware.Body body;
    private volatile DeviceStatus status = DeviceStatus.READY;

    public SimPinpoint(SimHardware.Body body) {
        super(nullI2c(), false);
        this.body = body;
    }

    private static I2cDeviceSynchSimple nullI2c() {
        return (I2cDeviceSynchSimple) Proxy.newProxyInstance(SimPinpoint.class.getClassLoader(),
                new Class<?>[]{I2cDeviceSynchSimple.class},
                (proxy, method, args) -> {
                    switch (method.getName()) {
                        case "hashCode": return System.identityHashCode(proxy);
                        case "equals": return proxy == args[0];
                        case "toString": return "Simulated I2C bus";
                        default: return SimHardware.defaultValue(method);
                    }
                });
    }

    @Override
    protected synchronized boolean doInitialize() {
        return true;
    }

    @Override public String getDeviceName() { return "Simulated goBILDA Pinpoint"; }
    @Override public String getConnectionInfo() { return "Simulator"; }
    @Override public void update() { }
    @Override public void update(ReadData data) { }
    @Override public void setOffsets(double xOffset, double yOffset, DistanceUnit distanceUnit) { }
    @Override public void setEncoderResolution(GoBildaOdometryPods pods) { }
    @Override public void setEncoderResolution(double ticksPerUnit, DistanceUnit distanceUnit) { }
    @Override public void setEncoderDirections(EncoderDirection xEncoder, EncoderDirection yEncoder) { }
    @Override public void setYawScalar(double yawScalar) { }
    @Override public void setErrorDetectionType(ErrorDetectionType e) { }
    @Override public void recalibrateIMU() { status = DeviceStatus.READY; }
    @Override public void resetPosAndIMU() { body.teleport(0, 0, 0); status = DeviceStatus.READY; }
    @Override public DeviceStatus getDeviceStatus() { return status; }
    @Override public int getDeviceID() { return 2; }
    @Override public int getDeviceVersion() { return 3; }
    @Override public int getLoopTime() { return 1000; }
    @Override public double getFrequency() { return 1000; }

    @Override
    public void setPosition(Pose2D pos) {
        body.teleport(pos.getX(DistanceUnit.INCH), pos.getY(DistanceUnit.INCH), pos.getHeading(AngleUnit.RADIANS));
    }

    @Override
    public void setPosX(double posX, DistanceUnit distanceUnit) {
        body.teleport(distanceUnit.toInches(posX), body.y(), body.heading());
    }

    @Override
    public void setPosY(double posY, DistanceUnit distanceUnit) {
        body.teleport(body.x(), distanceUnit.toInches(posY), body.heading());
    }

    @Override
    public void setHeading(double heading, AngleUnit angleUnit) {
        body.teleport(body.x(), body.y(), angleUnit.toRadians(heading));
    }

    @Override public double getPosX(DistanceUnit unit) { return unit.fromInches(body.x()); }
    @Override public double getPosY(DistanceUnit unit) { return unit.fromInches(body.y()); }
    @Override public double getHeading(AngleUnit unit) { return unit.fromRadians(AngleUnit.normalizeRadians(body.heading())); }
    @Override public double getHeading(UnnormalizedAngleUnit unit) { return unit.fromRadians(body.heading()); }
    @Override public double getVelX(DistanceUnit unit) { return unit.fromInches(body.vx()); }
    @Override public double getVelY(DistanceUnit unit) { return unit.fromInches(body.vy()); }
    @Override public double getHeadingVelocity(UnnormalizedAngleUnit unit) { return unit.fromRadians(body.omega()); }

    @Override
    public Pose2D getPosition() {
        return new Pose2D(DistanceUnit.INCH, body.x(), body.y(), AngleUnit.RADIANS, AngleUnit.normalizeRadians(body.heading()));
    }
}
