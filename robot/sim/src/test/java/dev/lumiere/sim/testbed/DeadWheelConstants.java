package dev.lumiere.sim.testbed;

import com.pedropathing.algorithm.Foresight;
import com.pedropathing.algorithm.ForesightConfig;
import com.pedropathing.controllers.Controller;
import com.pedropathing.follower.Follower;
import com.pedropathing.math.Matrix;
import com.pedropathing.math.Vector2D;
import com.pedropathing.revhub.drivetrains.Mecanum;
import com.pedropathing.revhub.drivetrains.MecanumConfig;
import com.pedropathing.revhub.localizers.Encoder;
import com.pedropathing.revhub.localizers.RevHubIMU;
import com.pedropathing.revhub.localizers.ThreeWheelIMUConfig;
import com.pedropathing.revhub.localizers.ThreeWheelIMULocalizer;
import com.qualcomm.hardware.rev.RevHubOrientationOnRobot;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.HardwareMap;

/**
 * A robot with three dead wheels on the drive motors' encoder ports and the hub's IMU, and its own
 * measured speeds: the simulator must drive it from Pedro Pathing alone, as it drives a Pinpoint robot.
 */
public final class DeadWheelConstants {
    public static final double FORWARD_VELOCITY = 45;
    public static final double STRAFE_VELOCITY = 30;

    public static MecanumConfig drivetrainConfig = new MecanumConfig(c -> {
        c.frontLeftName.set("lf");
        c.frontRightName.set("rf");
        c.backLeftName.set("lr");
        c.backRightName.set("rr");
        c.frontLeftDirection.set(DcMotorSimple.Direction.REVERSE);
        c.frontRightDirection.set(DcMotorSimple.Direction.FORWARD);
        c.backLeftDirection.set(DcMotorSimple.Direction.REVERSE);
        c.backRightDirection.set(DcMotorSimple.Direction.FORWARD);
    });

    public static ThreeWheelIMUConfig localizerConfig = new ThreeWheelIMUConfig(c -> {
        c.leftEncoderName.set("lf");
        c.rightEncoderName.set("lr");
        c.strafeEncoderName.set("rf");
        c.imuName.set("imu");
        c.leftPodY.set(2.5);
        c.rightPodY.set(-2.5);
        c.strafePodX.set(-2.5);
        c.forwardTicksToInches.set(0.002);
        c.strafeTicksToInches.set(0.002);
        c.turnTicksToRadians.set(0.002);
        c.leftEncoderDirection.set(Encoder.REVERSE);
        c.rightEncoderDirection.set(Encoder.REVERSE);
        c.strafeEncoderDirection.set(Encoder.FORWARD);
        c.imu.set(new RevHubIMU(new RevHubOrientationOnRobot(
                RevHubOrientationOnRobot.LogoFacingDirection.LEFT,
                RevHubOrientationOnRobot.UsbFacingDirection.UP)));
    });

    public static ForesightConfig foresightConfig = new ForesightConfig(c -> {
        c.forwardTranslational.set(Controller.piecewise(Controller.proportional(0.06)).put(2.5, Controller.proportional(0.12)));
        c.strafeTranslational.set(Controller.piecewise(Controller.proportional(0.08)).put(2.5, Controller.proportional(0.15)));
        c.coast.set(Controller.proportionalFeedforward(0.016));
        c.brake.set(Controller.proportionalFeedforward(0.016));
        c.headingFeedback.set(Controller.proportional(1.0));
        c.headingBrakeCoefficients.set(Vector2D.cartesian(0.1, 0.0));
        c.linearBrakeCoefficients.set(Matrix.diag(0.05, 0.06));
        c.quadraticBrakeCoefficients.set(Matrix.diag(0.0015, 0.002));
        c.maxAchievableForwardVelocity.set(FORWARD_VELOCITY);
        c.maxAchievableStrafeVelocity.set(STRAFE_VELOCITY);
        c.naturalForwardDeceleration.set(35.0);
        c.naturalStrafeDeceleration.set(70.0);
    });

    private DeadWheelConstants() {
    }

    public static Follower create(HardwareMap hardwareMap) {
        return new Follower(
                new ThreeWheelIMULocalizer(hardwareMap, localizerConfig),
                new Mecanum(hardwareMap, drivetrainConfig),
                new Foresight(foresightConfig));
    }
}
