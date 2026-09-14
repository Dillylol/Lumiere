package org.firstinspires.ftc.teamcode.simulation;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeFalse;

import dev.lumiere.sim.GamepadState;
import dev.lumiere.sim.HeadlessRun;
import dev.lumiere.sim.Simulator;
import dev.lumiere.sim.hardware.ServoState;

import org.firstinspires.ftc.teamcode.generated.robot2025robot.Auto2SpecimenFast;
import org.firstinspires.ftc.teamcode.generated.robot2025robot.DoNothing;
import org.firstinspires.ftc.teamcode.generated.samplerobot.BlueBasket;
import org.firstinspires.ftc.teamcode.generated.samplerobot.DriverControl;
import org.junit.Before;
import org.junit.Test;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Runs the generated golden OpModes in the desktop simulator. The CI copies this test and the golden
 * files from fixtures/ into a freshly generated robot project, so generated code is checked both for
 * compiling against the real libraries and for doing what the project describes.
 */
public class GeneratedCodeSimulationTest {
    @Before
    public void notInteractive() {
        assumeFalse(Simulator.isRequested());
        // Each test starts as if the robot had just been turned on.
        org.firstinspires.ftc.teamcode.generated.samplerobot.RobotPose.last = null;
        org.firstinspires.ftc.teamcode.generated.robot2025robot.RobotPose.last = null;
    }

    @Test
    public void blueBasketRunsItsRoutineAndParks() throws Exception {
        HeadlessRun.Result result = HeadlessRun.of(BlueBasket.class).seconds(25).run();
        assertNull(String.valueOf(result.failure), result.failure);
        assertEquals(result.toString(), 60, result.x, 3.0);
        assertEquals(result.toString(), 96, result.y, 3.0);
        assertTrue(result.toString(), result.telemetry.contains("Intake : STOP"));
        assertTrue(result.toString(), result.telemetry.contains("Claw : CLOSED"));
        assertTrue(result.toString(), result.telemetry.contains("Lift : DOWN"));
    }

    @Test
    public void awkwardNamesStillRun() throws Exception {
        HeadlessRun.Result result = HeadlessRun.of(Auto2SpecimenFast.class).seconds(10).run();
        assertNull(String.valueOf(result.failure), result.failure);
        assertEquals(result.toString(), 40, result.x, 3.0);
        assertEquals(result.toString(), 40, result.y, 3.0);
    }

    @Test
    public void anEmptyRoutineDoesNothingWithoutFailing() throws Exception {
        HeadlessRun.Result result = HeadlessRun.of(DoNothing.class).seconds(2).run();
        assertNull(String.valueOf(result.failure), result.failure);
        assertEquals(result.toString(), 9, result.x, 1.0);
        assertEquals(result.toString(), 9, result.y, 1.0);
    }

    @Test
    public void driverControlDrivesAndTogglesTheClaw() throws Exception {
        AtomicInteger ticks = new AtomicInteger();
        AtomicBoolean opened = new AtomicBoolean();
        HeadlessRun.Result result = HeadlessRun.of(DriverControl.class).seconds(1.5).during(simulation -> {
            int tick = ticks.incrementAndGet();
            GamepadState driver = new GamepadState();
            driver.leftStickY = -1f;
            simulation.setGamepad(1, driver);
            GamepadState operator = new GamepadState();
            operator.a = tick > 20 && tick < 30;
            simulation.setGamepad(2, operator);
            for (ServoState servo : simulation.hardware().servos()) {
                if (servo.name.equals("claw") && servo.position() == 0.8) opened.set(true);
            }
        }).run();
        assertNull(String.valueOf(result.failure), result.failure);
        assertTrue("the claw opened: " + result, opened.get());
        assertTrue("field-centric forward at heading 90 degrees drives +x: " + result, result.x > 90);
    }
}
