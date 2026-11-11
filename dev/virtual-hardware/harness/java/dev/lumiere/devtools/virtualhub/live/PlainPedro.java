package dev.lumiere.devtools.virtualhub.live;

import com.pedropathing.follower.Follower;
import com.pedropathing.math.Pose;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.hardware.DcMotor;

/**
 * An OpMode written the way many teams write theirs, for the virtual hub's contract checks: its Pedro
 * Pathing follower lives in the team's own robot object, and it never reports through
 * {@code Session}. The robot library must still report its pose and its motor's power.
 */
@Autonomous(name = "Plain Pedro (virtual hub)", group = "Virtual hub")
public class PlainPedro extends OpMode {
    /** The team's own robot object. */
    static final class Robot {
        Follower follower;
        DcMotor motor;
    }

    private final Robot robot = new Robot();

    @Override
    public void init() {
        robot.follower = new VirtualLive().createFollower(hardwareMap);
        robot.follower.setPose(new Pose(72, 72, Math.toRadians(90)));
        robot.motor = hardwareMap.get(DcMotor.class, "lumiere_check_motor");
    }

    @Override
    public void init_loop() {
        robot.follower.update();
    }

    @Override
    public void start() {
        robot.motor.setPower(0.3);
    }

    @Override
    public void loop() {
        robot.follower.update();
    }

    @Override
    public void stop() {
        robot.motor.setPower(0);
    }
}
