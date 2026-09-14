package org.firstinspires.ftc.teamcode.simulation;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assume.assumeFalse;

import {{SIM_PACKAGE}}.HeadlessRun;
import {{SIM_PACKAGE}}.Simulator;

import org.firstinspires.ftc.teamcode.examples.ExampleAuto;
import org.junit.Test;

/**
 * Runs Example Auto in the desktop simulator and checks where the robot parks. Add tests like this
 * for your own autonomous routines: they catch mistakes in paths and commands before robot time.
 *
 * <p>The simulator uses estimated physics, so passing here does not replace a low-power test on the
 * real field.
 */
public class ExampleAutoSimulationTest {
    @Test
    public void exampleAutoParks() throws Exception {
        assumeFalse("The interactive simulator is running", Simulator.isRequested());
        HeadlessRun.Result result = HeadlessRun.of(ExampleAuto.class).seconds(15).run();
        assertNull(String.valueOf(result.failure), result.failure);
        assertEquals(result.toString(), 36, result.x, 3.0);
        assertEquals(result.toString(), 24, result.y, 3.0);
    }
}
