package org.firstinspires.ftc.teamcode.pedro;

import com.pedropathing.algorithm.Foresight;
import com.pedropathing.algorithm.ForesightConfig;
import com.pedropathing.controllers.Controller;
import com.pedropathing.follower.Follower;
import com.pedropathing.math.Matrix;
import com.pedropathing.math.Vector2D;
import com.pedropathing.revhub.drivetrains.Mecanum;
import com.pedropathing.revhub.drivetrains.MecanumConfig;
import com.pedropathing.revhub.localizers.PinpointConfig;
import com.pedropathing.revhub.localizers.PinpointLocalizer;
import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.HardwareMap;

import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;

/**
 * Robot configuration for Pedro Pathing.
 *
 * <p>Each config below uses the same field names that AutoTune prints. After running a tuner
 * (Robot Controller Wi-Fi, http://192.168.43.1:10158), replace the matching block with its output
 * and set {@link #TUNED} to {@code true}.
 *
 * <p>Hardware names follow the FTC SDK samples (for example BasicOmniOpMode_Linear) and must match
 * the active configuration on the Driver Station.
 */
public final class Constants {
    /**
     * Set to true after the Mecanum, Pinpoint, and Foresight tuners have been run on this robot.
     * Untuned values are simulator estimates for a typical 312 RPM goBILDA mecanum drivetrain and
     * are shown as a warning in telemetry.
     */
    public static final boolean TUNED = false;

    public static MecanumConfig drivetrainConfig = new MecanumConfig(c -> {
        c.frontLeftName.set("left_front_drive");
        c.frontRightName.set("right_front_drive");
        c.backLeftName.set("left_back_drive");
        c.backRightName.set("right_back_drive");
        c.frontLeftDirection.set(DcMotorSimple.Direction.REVERSE);
        c.frontRightDirection.set(DcMotorSimple.Direction.FORWARD);
        c.backLeftDirection.set(DcMotorSimple.Direction.REVERSE);
        c.backRightDirection.set(DcMotorSimple.Direction.FORWARD);
    });

    public static PinpointConfig localizerConfig = new PinpointConfig(c -> {
        c.name.set("pinpoint");
        c.podType.set(GoBildaPinpointDriver.GoBildaOdometryPods.goBILDA_4_BAR_POD);
        c.xPodOffset.set(0.0);
        c.yPodOffset.set(0.0);
        c.xPodDirection.set(GoBildaPinpointDriver.EncoderDirection.FORWARD);
        c.yPodDirection.set(GoBildaPinpointDriver.EncoderDirection.FORWARD);
        c.globalDistanceUnit.set(DistanceUnit.INCH);
        c.offsetUnits.set(DistanceUnit.INCH);
    });

    public static ForesightConfig foresightConfig = new ForesightConfig(
            c -> {
                Controller primaryTranslationalForward = Controller.proportional(0.12);
                Controller secondaryTranslationalForward = Controller.proportional(0.06);
                Controller primaryTranslationalLateral = Controller.proportional(0.15);
                Controller secondaryTranslationalLateral = Controller.proportional(0.08);

                c.forwardTranslational.set(Controller.piecewise(secondaryTranslationalForward).put(2.5, primaryTranslationalForward));
                c.strafeTranslational.set(Controller.piecewise(secondaryTranslationalLateral).put(2.5, primaryTranslationalLateral));

                c.coast.set(Controller.proportionalFeedforward(0.016));
                c.brake.set(Controller.proportionalFeedforward(0.016));

                c.headingFeedback.set(Controller.proportional(1.0));
                c.headingBrakeCoefficients.set(Vector2D.cartesian(0.1, 0.0));

                c.linearBrakeCoefficients.set(Matrix.diag(0.05, 0.06));
                c.quadraticBrakeCoefficients.set(Matrix.diag(0.0015, 0.002));

                c.maxAchievableForwardVelocity.set(60.0);
                c.maxAchievableStrafeVelocity.set(50.0);
                c.naturalForwardDeceleration.set(40.0);
                c.naturalStrafeDeceleration.set(50.0);
            }
    );

    private Constants() {
    }

    /** Creates the follower used by every autonomous and TeleOp OpMode. */
    public static Follower create(HardwareMap hardwareMap) {
        return new Follower(
                new PinpointLocalizer(hardwareMap, localizerConfig),
                new Mecanum(hardwareMap, drivetrainConfig),
                new Foresight(foresightConfig)
        );
    }
}
