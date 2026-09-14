package org.firstinspires.ftc.teamcode.examples;

import com.bylazar.telemetry.PanelsTelemetry;
import com.bylazar.telemetry.TelemetryManager;
import com.pedropathing.drivetrain.DrivePowers;
import com.pedropathing.follower.Follower;
import com.pedropathing.follower.ManualDrive;
import com.pedropathing.math.Pose;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import org.firstinspires.ftc.teamcode.pedro.Constants;

import {{JAVA_PACKAGE}}.Session;

/**
 * Field-centric mecanum driving through the Pedro Pathing follower.
 *
 * <p>Left stick drives, right stick turns, right bumper holds slow mode, A toggles field-centric
 * driving, and the back button resets which way is "forward".
 */
@TeleOp(name = "Example TeleOp", group = "Examples")
public class ExampleTeleOp extends OpMode {
    private static final double SLOW_MODE_SCALE = 0.4;

    private Follower follower;
    private TelemetryManager panels;
    private Session session;
    private boolean fieldCentric = true;
    private double headingOffset = 0.0;

    @Override
    public void init() {
        panels = PanelsTelemetry.INSTANCE.getTelemetry();
        follower = Constants.create(hardwareMap);
        follower.setPose(ExampleAuto.lastPose != null ? ExampleAuto.lastPose : new Pose(72, 72, Math.PI / 2));
        follower.update();
        session = Session.attach(this).follower(follower);
    }

    @Override
    public void init_loop() {
        follower.update();
        report();
    }

    @Override
    public void loop() {
        if (gamepad1.aWasPressed()) {
            fieldCentric = !fieldCentric;
        }
        if (gamepad1.backWasPressed()) {
            headingOffset = -follower.pose().heading();
        }

        double scale = gamepad1.right_bumper ? SLOW_MODE_SCALE : 1.0;
        double forward = -gamepad1.left_stick_y * scale;
        double lateral = -gamepad1.left_stick_x * scale;
        double turn = -gamepad1.right_stick_x * scale;

        DrivePowers powers = new DrivePowers(forward, lateral, turn);
        if (fieldCentric) {
            powers = ManualDrive.fieldCentric(powers, follower.pose().heading(), headingOffset);
        }
        follower.manual(powers);
        follower.update();
        report();
    }

    @Override
    public void stop() {
        if (follower != null) {
            follower.stop();
        }
    }

    private void report() {
        Pose pose = follower.pose();
        if (!Constants.TUNED) {
            panels.addLine("Constants are not tuned yet. Run AutoTune before relying on the follower.");
        }
        panels.addData("drive", fieldCentric ? "field-centric" : "robot-centric");
        session.data("drive", fieldCentric ? "field-centric" : "robot-centric");
        panels.addData("x (in)", pose.x());
        panels.addData("y (in)", pose.y());
        panels.addData("heading (deg)", Math.toDegrees(pose.heading()));
        FieldDrawing.drawRobot(pose);
        panels.update(telemetry);
        session.update();
    }
}
