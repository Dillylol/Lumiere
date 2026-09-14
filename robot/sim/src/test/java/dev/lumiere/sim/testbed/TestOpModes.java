package dev.lumiere.sim.testbed;

import static com.pedropathing.api.Paths.curve;
import static com.pedropathing.api.Paths.line;
import static com.pedropathing.ivy.commands.Commands.waitMs;
import static com.pedropathing.ivy.groups.Groups.sequential;
import static com.pedropathing.ivy.pedro.PedroCommands.follow;

import com.pedropathing.api.PoseFactory;
import com.pedropathing.follower.Follower;
import com.pedropathing.ivy.Scheduler;
import com.pedropathing.math.Pose;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.Disabled;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.Servo;

import dev.lumiere.ftc.Session;

/** OpModes used by the simulator tests. They use only public FTC, Pedro Pathing, and Ivy APIs. */
public final class TestOpModes {
    private TestOpModes() {
    }

    @Autonomous(name = "Test Path Auto", group = "Tests")
    public static class PathAuto extends OpMode {
        private final PoseFactory poses = PoseFactory.degrees();
        private final Pose start = poses.of(24, 72, 0);
        private final Pose middle = poses.of(72, 72, 0);
        private final Pose end = poses.of(96, 36, 90);
        private Follower follower;
        private Session session;

        @Override
        public void init() {
            Scheduler.reset();
            follower = TestConstants.create(hardwareMap);
            follower.setPose(start);
            follower.update();
            session = Session.attach(this).follower(follower);
        }

        @Override
        public void start() {
            Scheduler.schedule(sequential(
                    follow(follower, line(start, middle).constant(0)),
                    waitMs(250),
                    follow(follower, curve(middle, poses.of(96, 72, 0), end).linear(middle, end))));
        }

        @Override
        public void loop() {
            follower.update();
            Scheduler.execute();
            telemetry.addData("x", "%.1f", follower.pose().x());
            session.update();
        }

        @Override
        public void stop() {
            Scheduler.reset();
        }
    }

    @TeleOp(name = "Test Drive", group = "Tests")
    public static class Drive extends OpMode {
        private Follower follower;
        private Servo claw;
        private boolean clawOpen;

        @Override
        public void init() {
            follower = TestConstants.create(hardwareMap);
            follower.setPose(new Pose(72, 72, 0));
            claw = hardwareMap.get(Servo.class, "claw");
            claw.setPosition(0);
        }

        @Override
        public void loop() {
            if (gamepad1.aWasPressed()) {
                clawOpen = !clawOpen;
                claw.setPosition(clawOpen ? 1 : 0);
            }
            follower.manual(-gamepad1.left_stick_y, -gamepad1.left_stick_x, -gamepad1.right_stick_x);
            follower.update();
            telemetry.addData("claw", clawOpen ? "open" : "closed");
        }
    }

    @Autonomous(name = "Test Arm", group = "Tests")
    public static class Arm extends LinearOpMode {
        @Override
        public void runOpMode() {
            DcMotor arm = hardwareMap.get(DcMotor.class, "arm");
            arm.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
            arm.setTargetPosition(400);
            arm.setMode(DcMotor.RunMode.RUN_TO_POSITION);
            waitForStart();
            arm.setPower(0.8);
            while (opModeIsActive() && arm.isBusy()) {
                telemetry.addData("arm", arm.getCurrentPosition());
                telemetry.update();
                sleep(10);
            }
            telemetry.addData("done", arm.getCurrentPosition());
            telemetry.update();
        }
    }

    @Autonomous(name = "Test Crash", group = "Tests")
    public static class Crash extends OpMode {
        @Override
        public void init() {
        }

        @Override
        public void loop() {
            throw new IllegalStateException("intake jammed");
        }
    }

    /** A loop() that never returns, so the SDK's stop request is never seen. */
    @Autonomous(name = "Test Stuck", group = "Tests")
    public static class Stuck extends OpMode {
        @Override
        public void init() {
        }

        @Override
        @SuppressWarnings("StatementWithEmptyBody")
        public void loop() {
            while (!Thread.currentThread().isInterrupted()) {
                // Busy-waits for a condition that never happens.
            }
        }
    }

    @Disabled
    @TeleOp(name = "Test Disabled")
    public static class Hidden extends OpMode {
        @Override
        public void init() {
        }

        @Override
        public void loop() {
        }
    }
}
