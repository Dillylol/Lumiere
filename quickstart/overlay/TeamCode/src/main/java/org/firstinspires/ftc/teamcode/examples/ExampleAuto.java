package org.firstinspires.ftc.teamcode.examples;

import static com.pedropathing.api.Paths.curve;
import static com.pedropathing.api.Paths.line;
import static com.pedropathing.ivy.commands.Commands.waitMs;
import static com.pedropathing.ivy.groups.Groups.sequential;
import static com.pedropathing.ivy.pedro.PedroCommands.follow;

import com.bylazar.telemetry.PanelsTelemetry;
import com.bylazar.telemetry.TelemetryManager;
import com.pedropathing.api.PoseFactory;
import com.pedropathing.follower.Follower;
import com.pedropathing.ivy.Command;
import com.pedropathing.ivy.Scheduler;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;

import org.firstinspires.ftc.teamcode.pedro.Constants;

import {{JAVA_PACKAGE}}.Headings;
import {{JAVA_PACKAGE}}.Session;

/**
 * A short autonomous that drives a line, pauses, follows a curve, and parks.
 *
 * <p>Poses use Pedro Pathing field coordinates: inches from the bottom-left corner of the field,
 * with heading 0 pointing along +x and angles increasing counterclockwise. Adjust them for your
 * starting position before running on a real field.
 */
@Autonomous(name = "Example Auto", group = "Examples", preselectTeleOp = "Example TeleOp")
public class ExampleAuto extends OpMode {
    /** The last known pose, handed to TeleOp so field-centric driving starts aligned. */
    public static Pose lastPose = null;

    private final PoseFactory poses = PoseFactory.degrees();
    private final Pose startPose = poses.of(9, 72, 0);
    private final Pose scorePose = poses.of(36, 84, 45);
    private final Pose pickupControl = poses.of(36, 36, 0);
    private final Pose pickupPose = poses.of(60, 48, 180);
    private final Pose parkPose = poses.of(36, 24, 270);

    private Follower follower;
    private TelemetryManager panels;
    private Session session;

    // Headings.linear turns from one pose's heading to the next. It is used instead of Path.linear,
    // which turns the wrong way on straight lines in Pedro Pathing 3.0.0.
    private Path startToScore() {
        return line(startPose, scorePose).heading(Headings.linear(startPose, scorePose));
    }

    private Path scoreToPickup() {
        return curve(scorePose, pickupControl, pickupPose).heading(Headings.linear(scorePose, pickupPose));
    }

    private Path pickupToPark() {
        return line(pickupPose, parkPose).tangent();
    }

    private Command routine() {
        return sequential(
                follow(follower, startToScore()),
                waitMs(500),
                follow(follower, scoreToPickup()),
                follow(follower, pickupToPark())
        );
    }

    @Override
    public void init() {
        Scheduler.reset();
        panels = PanelsTelemetry.INSTANCE.getTelemetry();
        follower = Constants.create(hardwareMap);
        follower.setPose(startPose);
        follower.update();
        // Shows the robot, its path, and its target live in {{APP_NAME}}.
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
            lastPose = follower.pose();
            follower.stop();
        }
    }

    private void report() {
        Pose pose = follower.pose();
        if (!Constants.TUNED) {
            panels.addLine("Constants are not tuned yet. Run AutoTune before trusting paths.");
        }
        panels.addData("x (in)", pose.x());
        panels.addData("y (in)", pose.y());
        panels.addData("heading (deg)", Math.toDegrees(pose.heading()));
        panels.addData("follower", follower.mode());
        FieldDrawing.drawRobot(pose);
        panels.update(telemetry);
        session.update();
    }
}
