package dev.lumiere.sim;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import dev.lumiere.sim.hardware.ServoState;
import dev.lumiere.sim.testbed.TestConstants;
import dev.lumiere.sim.testbed.TestOpModes;

import org.junit.Test;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** Runs real OpModes, the real Pedro Pathing follower, and Ivy through the simulator. */
public class SimulationTest {
    private static SimulatorConfig config() {
        SimulatorConfig config = new SimulatorConfig();
        config.constantsClass = TestConstants.class.getName();
        return config;
    }

    @Test
    public void autonomousFollowsALineAndCurveToTheEndPose() throws Exception {
        HeadlessRun.Result result = HeadlessRun.of(TestOpModes.PathAuto.class).config(config()).seconds(9).run();
        assertNull(String.valueOf(result.failure), result.failure);
        assertEquals(result.toString(), 96, result.x, 2.0);
        assertEquals(result.toString(), 36, result.y, 2.0);
        assertEquals(result.toString(), 90, result.headingDegrees, 5.0);
        assertTrue(result.toString(), result.telemetry.get(0).startsWith("x : "));
    }

    @Test
    public void teleOpDrivesWithTheGamepadAndTogglesAServo() throws Exception {
        AtomicInteger ticks = new AtomicInteger();
        AtomicBoolean clawOpened = new AtomicBoolean();
        HeadlessRun.Result result = HeadlessRun.of(TestOpModes.Drive.class).config(config()).seconds(1.5)
                .during(simulation -> {
                    int tick = ticks.incrementAndGet();
                    GamepadState state = new GamepadState();
                    state.leftStickY = -1f;  // pushed forward
                    state.a = tick > 20 && tick < 30;
                    simulation.setGamepad(1, state);
                    for (ServoState servo : simulation.hardware().servos()) {
                        if (servo.name.equals("claw") && servo.position() == 1.0) clawOpened.set(true);
                    }
                }).run();
        assertNull(String.valueOf(result.failure), result.failure);
        assertTrue("robot drove forward (+x at heading 0): " + result, result.x > 110);
        assertEquals(result.toString(), 72, result.y, 3.0);
        assertTrue("A toggled the claw open", clawOpened.get());
        assertEquals("claw : open", result.telemetry.get(0));
    }

    @Test
    public void linearOpModeRunsAMotorToPosition() throws Exception {
        HeadlessRun.Result result = HeadlessRun.of(TestOpModes.Arm.class).config(config()).seconds(5).run();
        assertNull(String.valueOf(result.failure), result.failure);
        String last = result.telemetry.get(result.telemetry.size() - 1);
        assertTrue(result.toString(), last.startsWith("done : "));
        int position = Integer.parseInt(last.substring("done : ".length()));
        assertEquals(400, position, 12);
    }

    @Test
    public void anExceptionInTheOpModeIsReportedAndStopsIt() throws Exception {
        HeadlessRun.Result result = HeadlessRun.of(TestOpModes.Crash.class).config(config()).seconds(3).run();
        assertNotNull(result.failure);
        assertEquals("intake jammed", result.failure.getMessage());
    }

    @Test
    public void anOpModeThatIgnoresStopIsInterruptedAndReported() throws Exception {
        long started = System.currentTimeMillis();
        HeadlessRun.Result result = HeadlessRun.of(TestOpModes.Stuck.class).config(config()).seconds(0.5).run();
        assertNotNull(result.failure);
        assertTrue(result.failure.getMessage(), result.failure.getMessage().contains("did not stop"));
        assertTrue(System.currentTimeMillis() - started < 6000);
    }

    @Test
    public void unconfiguredDevicesAreCreatedOnDemandAndReported() throws Exception {
        try (Simulation simulation = new Simulation(config().robot, DrivetrainDiscovery.discover(TestConstants.class.getName()), 72, 72, 0, null)) {
            simulation.init(new TestOpModes.Drive(), "Test Drive");
            long deadline = System.currentTimeMillis() + 3000;
            while (simulation.hardware().typeOf("claw") == null && System.currentTimeMillis() < deadline) Thread.sleep(10);
            assertEquals("servo", simulation.hardware().typeOf("claw"));
            assertEquals("motor", simulation.hardware().typeOf("fl"));
            assertEquals("pinpoint", simulation.hardware().typeOf("odometry"));
            assertTrue(simulation.mechanismOutputs().containsKey("claw"));
            simulation.stop();
            assertEquals(Simulation.Phase.STOPPED, simulation.phase());
        }
    }
}
