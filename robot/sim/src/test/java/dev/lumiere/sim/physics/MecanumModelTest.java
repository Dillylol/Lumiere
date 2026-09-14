package dev.lumiere.sim.physics;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DcMotorSimple;

import dev.lumiere.sim.hardware.MotorState;
import dev.lumiere.sim.hardware.SimHardware;

import org.junit.Before;
import org.junit.Test;

public class MecanumModelTest {
    private MecanumModel model;
    private DcMotorEx fl;
    private DcMotorEx fr;
    private DcMotorEx bl;
    private DcMotorEx br;
    private MotorState flState;

    @Before
    public void setUp() {
        model = new MecanumModel(new RobotParameters(), 72, 72, 0);
        SimHardware hardware = new SimHardware(model);
        fl = (DcMotorEx) hardware.getOrCreate(DcMotorEx.class, "fl");
        fr = (DcMotorEx) hardware.getOrCreate(DcMotorEx.class, "fr");
        bl = (DcMotorEx) hardware.getOrCreate(DcMotorEx.class, "bl");
        br = (DcMotorEx) hardware.getOrCreate(DcMotorEx.class, "br");
        flState = hardware.motor("fl");
        // Wiring as described by typical constants: the left side is mirrored.
        hardware.motor("fl").setMountSign(-1);
        hardware.motor("bl").setMountSign(-1);
        fl.setDirection(DcMotorSimple.Direction.REVERSE);
        bl.setDirection(DcMotorSimple.Direction.REVERSE);
        model.setDriveMotors(hardware.motor("fl"), hardware.motor("fr"), hardware.motor("bl"), hardware.motor("br"));
    }

    private void drive(double forward, double left, double turn) {
        fl.setPower(forward - left - turn);
        fr.setPower(forward + left + turn);
        bl.setPower(forward + left - turn);
        br.setPower(forward - left + turn);
    }

    private void run(double seconds) {
        for (int i = 0; i < seconds * 1000; i++) model.step(0.001);
    }

    @Test
    public void fullForwardReachesFreeSpeedAlongHeading() {
        drive(1, 0, 0);
        run(1.0);
        RobotParameters p = new RobotParameters();
        double expected = p.freeWheelSpeed() * model.batteryVolts() / 12.0;
        assertEquals(expected, model.vx(), 1.0);
        assertEquals(0, model.vy(), 1e-6);
        assertTrue(model.x() > 72 + expected * 0.6);
        assertEquals(72, model.y(), 1e-6);
    }

    @Test
    public void positiveStrafeMovesLeftAndIsLessEfficient() {
        drive(0, 1, 0);
        run(1.0);
        assertEquals(0, model.vx(), 1e-6);
        assertTrue("left is +y at heading 0", model.vy() > 0);
        double forwardSpeed = new RobotParameters().freeWheelSpeed() * model.batteryVolts() / 12.0;
        assertEquals(forwardSpeed * new RobotParameters().strafeEfficiency, model.vy(), 1.0);
    }

    @Test
    public void positiveTurnIsCounterclockwise() {
        drive(0, 0, 0.5);
        run(0.5);
        assertTrue(model.omega() > 0);
        assertTrue(model.heading() > 0);
        assertEquals(72, model.x(), 0.01);
    }

    @Test
    public void forwardMotionIsRotatedByHeading() {
        model.teleport(72, 72, Math.PI / 2);
        drive(0.5, 0, 0);
        run(0.5);
        assertEquals(72, model.x(), 1e-6);
        assertTrue(model.y() > 80);
    }

    @Test
    public void brakeStopsFasterThanCoast() {
        model.teleport(20, 72, 0);
        drive(1, 0, 0);
        run(0.6);
        fl.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.FLOAT);
        fr.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.FLOAT);
        bl.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.FLOAT);
        br.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.FLOAT);
        drive(0, 0, 0);
        double start = model.x();
        run(2.5);
        double coastDistance = model.x() - start;
        assertTrue("coasting did not reach the wall", model.x() < 130);

        setUp();
        model.teleport(20, 72, 0);
        drive(1, 0, 0);
        run(0.6);
        fl.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
        fr.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
        bl.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
        br.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
        drive(0, 0, 0);
        start = model.x();
        run(2.5);
        double brakeDistance = model.x() - start;

        assertTrue("coast " + coastDistance + " vs brake " + brakeDistance, brakeDistance < coastDistance / 3);
        assertEquals(0, model.vx(), 1e-3);
    }

    @Test
    public void wallsStopTheRobotInsideTheField() {
        drive(1, 0, 0);
        run(5.0);
        RobotParameters p = new RobotParameters();
        assertEquals(144 - p.lengthInches / 2, model.x(), 1e-6);
        assertEquals(0, model.vx(), 1e-6);
    }

    @Test
    public void driveEncodersCountForwardForConfiguredDirections() {
        drive(0.5, 0, 0);
        run(1.0);
        int ticks = fl.getCurrentPosition();
        assertTrue(ticks > 0);
        double inches = (double) ticks / flState.ticksPerRev * new RobotParameters().wheelCircumference();
        assertEquals(model.x() - 72, inches, 0.5);
        assertEquals(ticks, fr.getCurrentPosition(), 2);
    }

    @Test
    public void batterySagsUnderLoad() {
        double rest = model.batteryVolts();
        drive(1, 0, 0);
        run(0.1);
        assertTrue(model.batteryVolts() < rest);
    }
}
