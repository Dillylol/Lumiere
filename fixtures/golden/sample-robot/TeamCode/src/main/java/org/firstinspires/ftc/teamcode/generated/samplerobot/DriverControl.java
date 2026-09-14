// GENERATED FILE: edit the "Sample Robot" project in Lumière instead. To keep hand edits, delete these two lines.
// checksum: 82a2075de94e6d75
package org.firstinspires.ftc.teamcode.generated.samplerobot;

import com.pedropathing.api.PoseFactory;
import com.pedropathing.drivetrain.DrivePowers;
import com.pedropathing.follower.Follower;
import com.pedropathing.follower.ManualDrive;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import org.firstinspires.ftc.teamcode.pedro.Constants;

import dev.lumiere.ftc.Session;

/** Generated from the "Driver Control" TeleOp. */
@TeleOp(name = "Driver Control", group = "Match")
public class DriverControl extends OpMode {
    private static final boolean FIELD_CENTRIC = true;
    private static final double SLOW_MODE_SCALE = 0.4;

    private final PoseFactory poses = PoseFactory.degrees();
    private Follower follower;
    private Session session;
    private Claw claw;
    private Lift lift;
    private Intake intake;
    private boolean clawToggleA = false;
    private double headingOffset = 0;

    @Override
    public void init() {
        follower = Constants.create(hardwareMap);
        follower.setPose(RobotPose.last != null ? RobotPose.last : poses.of(72, 72, 90));
        follower.update();
        claw = new Claw(hardwareMap);
        claw.initialize();
        lift = new Lift(hardwareMap);
        lift.initialize();
        intake = new Intake(hardwareMap);
        intake.initialize();
        session = Session.attach(this).follower(follower);
    }

    @Override
    public void init_loop() {
        follower.update();
        report();
    }

    @Override
    public void loop() {
        if (gamepad2.aWasPressed()) {
            clawToggleA = !clawToggleA;
            claw.set(clawToggleA ? Claw.State.OPEN : Claw.State.CLOSED);
        }
        if (gamepad2.rightBumperWasPressed()) intake.set(Intake.State.IN);
        if (gamepad2.rightBumperWasReleased()) intake.set(Intake.State.STOP);
        if (gamepad2.leftBumperWasPressed()) intake.set(Intake.State.OUT);
        if (gamepad2.leftBumperWasReleased()) intake.set(Intake.State.STOP);
        if (gamepad2.dpadUpWasPressed()) lift.set(Lift.State.HIGH_BASKET);
        if (gamepad2.dpadDownWasPressed()) lift.set(Lift.State.DOWN);

        if (gamepad1.backWasPressed()) headingOffset = -follower.pose().heading();
        double scale = gamepad1.right_bumper ? SLOW_MODE_SCALE : 1.0;
        DrivePowers powers = new DrivePowers(
                -gamepad1.left_stick_y * scale,
                -gamepad1.left_stick_x * scale,
                -gamepad1.right_stick_x * scale);
        if (FIELD_CENTRIC) powers = ManualDrive.fieldCentric(powers, follower.pose().heading(), headingOffset);
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
        telemetry.addData("Claw", claw.state());
        telemetry.addData("Lift", lift.state());
        telemetry.addData("Intake", intake.state());
        session.update();
    }
}
