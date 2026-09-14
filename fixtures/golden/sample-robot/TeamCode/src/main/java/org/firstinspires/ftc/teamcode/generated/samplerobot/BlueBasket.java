// GENERATED FILE: edit the "Sample Robot" project in Lumière instead. To keep hand edits, delete these two lines.
// checksum: 8536357a955ca1f4
package org.firstinspires.ftc.teamcode.generated.samplerobot;

import static com.pedropathing.api.Paths.curve;
import static com.pedropathing.api.Paths.line;
import static com.pedropathing.api.Paths.path;
import static com.pedropathing.ivy.commands.Commands.waitMs;
import static com.pedropathing.ivy.groups.Groups.parallel;
import static com.pedropathing.ivy.groups.Groups.race;
import static com.pedropathing.ivy.groups.Groups.sequential;
import static com.pedropathing.ivy.pedro.PedroCommands.follow;

import com.pedropathing.api.PoseFactory;
import com.pedropathing.follower.Follower;
import com.pedropathing.ivy.Command;
import com.pedropathing.ivy.Scheduler;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;

import org.firstinspires.ftc.teamcode.pedro.Constants;

import dev.lumiere.ftc.Headings;
import dev.lumiere.ftc.Session;

/** Generated from the "Blue Basket" autonomous. */
@Autonomous(name = "Blue Basket", group = "Match", preselectTeleOp = "Driver Control")
public class BlueBasket extends OpMode {
    private final PoseFactory poses = PoseFactory.degrees();
    private final Pose startPose = poses.of(9, 111, 270);
    private final Pose toBasketEnd = poses.of(18, 126, 315);
    private final Pose toFirstSampleEnd = poses.of(30, 120, 68.198591);
    private final Pose backToBasketPoint1 = poses.of(24, 116, 213.690068);
    private final Pose backToBasketPoint2 = poses.of(18, 126, 75.963757);
    private final Pose parkEnd = poses.of(60, 96, 296.565051);

    private Follower follower;
    private Session session;
    private Claw claw;
    private Lift lift;
    private Intake intake;

    /** To basket */
    private Path toBasket() {
        return line(startPose, toBasketEnd).heading(Headings.linear(Math.toRadians(270), Math.toRadians(315)));
    }

    /** To first sample */
    private Path toFirstSample() {
        return curve(toBasketEnd, new Pose(26, 110), toFirstSampleEnd).tangent();
    }

    /** Back to basket */
    private Path backToBasket() {
        return path(
                line(toFirstSampleEnd, backToBasketPoint1),
                curve(backToBasketPoint1, new Pose(16, 118), backToBasketPoint2)
        ).heading(Headings.linear(Math.toRadians(0), Math.toRadians(315)));
    }

    /** Park */
    private Path park() {
        return curve(backToBasketPoint2, new Pose(60, 126), parkEnd).heading(Headings.piecewise().constant(0, 0.5, Math.toRadians(315)).facingPoint(0.5, 1, 72, 72).build());
    }

    private Command routine() {
        return sequential(
                parallel(
                    follow(follower, toBasket()),
                    lift.command(Lift.State.HIGH_BASKET)
                ),
                claw.command(Claw.State.OPEN),
                waitMs(300),
                lift.command(Lift.State.DOWN),
                parallel(
                    follow(follower, toFirstSample()),
                    intake.command(Intake.State.IN)
                ),
                race(
                    waitMs(800),
                    claw.command(Claw.State.CLOSED)
                ),
                follow(follower, backToBasket()),
                intake.command(Intake.State.STOP),
                follow(follower, park())
        );
    }

    @Override
    public void init() {
        Scheduler.reset();
        follower = Constants.create(hardwareMap);
        follower.setPose(startPose);
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
    public void start() {
        Scheduler.schedule(routine());
    }

    @Override
    public void loop() {
        follower.update();
        Scheduler.execute();
        report();
    }

    @Override
    public void stop() {
        Scheduler.reset();
        if (follower != null) {
            RobotPose.last = follower.pose();
            follower.stop();
        }
    }

    private void report() {
        Pose pose = follower.pose();
        telemetry.addData("x (in)", "%.1f", pose.x());
        telemetry.addData("y (in)", "%.1f", pose.y());
        telemetry.addData("heading (deg)", "%.1f", Math.toDegrees(pose.heading()));
        telemetry.addData("Claw", claw.state());
        telemetry.addData("Lift", lift.state());
        telemetry.addData("Intake", intake.state());
        session.update();
    }
}
