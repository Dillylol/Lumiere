// GENERATED FILE: edit the "2025 Robot!" project in Lumière instead. To keep hand edits, delete these two lines.
// checksum: 431c4225dc1b4fed
package org.firstinspires.ftc.teamcode.generated.robot2025robot;

import static com.pedropathing.ivy.commands.Commands.instant;
import static com.pedropathing.ivy.groups.Groups.sequential;

import com.pedropathing.api.PoseFactory;
import com.pedropathing.follower.Follower;
import com.pedropathing.ivy.Command;
import com.pedropathing.ivy.Scheduler;
import com.pedropathing.math.Pose;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;

import org.firstinspires.ftc.teamcode.pedro.Constants;

import dev.lumiere.ftc.Session;

/** Generated from the "Do Nothing" autonomous. */
@Autonomous(name = "Do Nothing", group = "Tests")
public class DoNothing extends OpMode {
    private static final String ROUTINE_REVISION = "a797cc5b89f7a54c";

    private final PoseFactory poses = PoseFactory.degrees();
    private final Pose startPose = poses.of(9, 9, 0);

    private Follower follower;
    private Session session;
    private long routineStartedNanos;
    private ClassMechanism classMechanism;

    private Command routine() {
        return sequential(
                instant(this::reportRoutineCompletion)
        );
    }

    @Override
    public void init() {
        Scheduler.reset();
        follower = Constants.create(hardwareMap);
        follower.setPose(startPose);
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
    public void start() {
        routineStartedNanos = System.nanoTime();
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
        if (session != null) session.close();
    }

    private void reportRoutineCompletion() {
        double elapsedMs = (System.nanoTime() - routineStartedNanos) / 1_000_000.0;
        session.data("lumiere.routineElapsedMs", elapsedMs);
        session.data("lumiere.routineRevision", ROUTINE_REVISION);
    }

    private void report() {
        session.data("lumiere.routineRevision", ROUTINE_REVISION);
        Pose pose = follower.pose();
        telemetry.addData("x (in)", "%.1f", pose.x());
        telemetry.addData("y (in)", "%.1f", pose.y());
        telemetry.addData("heading (deg)", "%.1f", Math.toDegrees(pose.heading()));
        telemetry.addData("class", classMechanism.state());
        session.update();
    }
}
