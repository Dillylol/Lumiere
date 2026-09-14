// GENERATED FILE: edit the "2025 Robot!" project in Lumière instead. To keep hand edits, delete these two lines.
// checksum: 5afa6bf21bedec2c
package org.firstinspires.ftc.teamcode.generated.robot2025robot;

import com.pedropathing.api.PoseFactory;
import com.pedropathing.drivetrain.DrivePowers;
import com.pedropathing.follower.Follower;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import org.firstinspires.ftc.teamcode.pedro.Constants;

import dev.lumiere.ftc.Session;

/** Generated from the "RobotPose" TeleOp. */
@TeleOp(name = "RobotPose")
public class RobotPose2 extends OpMode {
    private static final boolean FIELD_CENTRIC = false;
    private static final double SLOW_MODE_SCALE = 1;

    private final PoseFactory poses = PoseFactory.degrees();
    private Follower follower;
    private Session session;
    private ClassMechanism classMechanism;
    private double headingOffset = 0;

    @Override
    public void init() {
        follower = Constants.create(hardwareMap);
        follower.setPose(RobotPose.last != null ? RobotPose.last : poses.of(72, 72, 0));
        follower.update();
        classMechanism = new ClassMechanism(hardwareMap);
        classMechanism.initialize();
        session = Session.attach(this).follower(follower);
    }

    @Override
    public void init_loop() {
        follower.update();
        report();
    }

    @Override
    public void loop() {
        if (gamepad1.yWasPressed()) classMechanism.set(ClassMechanism.State.STATE1ST_POSITION2);

        double scale = 1.0;
        DrivePowers powers = new DrivePowers(
                -gamepad1.left_stick_y * scale,
                -gamepad1.left_stick_x * scale,
                -gamepad1.right_stick_x * scale);
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
        telemetry.addData("drive", FIELD_CENTRIC ? "field-centric" : "robot-centric");
        telemetry.addData("heading (deg)", "%.1f", Math.toDegrees(follower.pose().heading()));
        telemetry.addData("class", classMechanism.state());
        session.update();
    }
}
