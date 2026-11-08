// GENERATED FILE: edit the "2025 Robot!" project in Lumière instead. To keep hand edits, delete these two lines.
// checksum: 9cf845bc7de67c65
package org.firstinspires.ftc.teamcode.generated.robot2025robot;

import static com.pedropathing.api.Paths.line;
import static com.pedropathing.ivy.commands.Commands.instant;
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

/** Generated from the "2 Specimen "Fast"" autonomous. */
@Autonomous(name = "2 Specimen \"Fast\"")
public class Auto2SpecimenFast extends OpMode {
    private static final String ROUTINE_REVISION = "43c059c32e4e16bd";

    private final PoseFactory poses = PoseFactory.degrees();
    private final Pose startPose = poses.of(72, 9, 90);
    private final Pose init2End = poses.of(72, 40, 90);
    private final Pose path2End = poses.of(40, 40, 0);

    private Follower follower;
    private Session session;
    private long routineStartedNanos;
    private ClassMechanism classMechanism;

    /** init */
    private Path init2() {
        return line(startPose, init2End).constant(Math.toRadians(90));
    }

    private Path path2() {
        return line(init2End, path2End).heading(Headings.piecewise().tangent(0, 1, true).build());
    }

    private Command routine() {
        return sequential(
                follow(follower, init2()),
                classMechanism.command(ClassMechanism.State.ELEVE_QUOTED),
                follow(follower, path2()),
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
