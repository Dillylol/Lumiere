// GENERATED FILE: edit the "Direct Devices" project in Lumière instead. To keep hand edits, delete these two lines.
// checksum: 922a329e860a9d12
package org.firstinspires.ftc.teamcode.generated.directdevices;

import static com.pedropathing.api.Paths.line;
import static com.pedropathing.ivy.commands.Commands.instant;
import static com.pedropathing.ivy.commands.Commands.waitMs;
import static com.pedropathing.ivy.groups.Groups.parallel;
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
import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.Servo;

import org.firstinspires.ftc.teamcode.pedro.Constants;

import dev.lumiere.ftc.Session;

/** Generated from the "Direct Auto" autonomous. */
@Autonomous(name = "Direct Auto")
public class DirectAuto extends OpMode {
    private static final String ROUTINE_REVISION = "a1b5c5463324c3b5";

    private final PoseFactory poses = PoseFactory.degrees();
    private final Pose startPose = poses.of(9, 72, 0);
    private final Pose outEnd = poses.of(40, 72, 0);

    private Follower follower;
    private Session session;
    private long routineStartedNanos;
    private Roller roller;
    private DcMotor intake;
    private DcMotor lift;
    private Servo kicker;
    private CRServo spinner;

    /** Out */
    private Path out() {
        return line(startPose, outEnd).constant(Math.toRadians(0));
    }

    /** Drives a motor to an encoder target at up to the given power, and finishes when it gets there. */
    private Command runToTarget(DcMotor motor, int ticks, double power) {
        return Command.build()
                .setStart(() -> {
                    motor.setTargetPosition(ticks);
                    motor.setMode(DcMotor.RunMode.RUN_TO_POSITION);
                    motor.setPower(power);
                })
                .setDone(() -> !motor.isBusy());
    }

    private Command routine() {
        return sequential(
                parallel(
                    follow(follower, out()),
                    instant(() -> intake.setPower(0.7 /* 0.9, cut to the power limit on the Robot page */)),
                    roller.command(Roller.State.SPIN)
                ),
                runToTarget(lift, 1200, 0.8 /* 1, cut to the power limit on the Robot page */),
                instant(() -> kicker.setPosition(0.6)),
                instant(() -> spinner.setPower(0.5 /* 1, cut to the power limit on the Robot page */)),
                waitMs(500),
                instant(() -> { lift.setMode(DcMotor.RunMode.RUN_USING_ENCODER); lift.setPower(-0.2); }),
                instant(() -> intake.setPower(0)),
                instant(() -> spinner.setPower(0)),
                roller.command(Roller.State.STOP),
                instant(this::reportRoutineCompletion)
        );
    }

    @Override
    public void init() {
        Scheduler.reset();
        follower = Constants.create(hardwareMap);
        follower.setPose(startPose);
        follower.update();
        roller = new Roller(hardwareMap);
        roller.initialize();
        intake = hardwareMap.get(DcMotor.class, "intake");
        intake.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
        lift = hardwareMap.get(DcMotor.class, "lift");
        lift.setDirection(DcMotorSimple.Direction.REVERSE);
        lift.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
        lift.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
        kicker = hardwareMap.get(Servo.class, "kicker");
        kicker.setDirection(Servo.Direction.REVERSE);
        spinner = hardwareMap.get(CRServo.class, "spinner");
        spinner.setDirection(DcMotorSimple.Direction.REVERSE);
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
        telemetry.addData("Roller", roller.state());
        session.update();
    }
}
