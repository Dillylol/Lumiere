package org.firstinspires.ftc.teamcode.simulation;

import static org.junit.Assume.assumeTrue;

import {{SIM_PACKAGE}}.Simulator;

import org.junit.Test;

/**
 * Starts the desktop simulator for {{APP_NAME}}. It only runs when {{APP_NAME}} launches it; a normal
 * test run skips it.
 */
public class RunSimulator {
    @Test
    public void run() throws Exception {
        assumeTrue("Started by {{APP_NAME}}", Simulator.isRequested());
        Simulator.runFromSystemProperties();
    }
}
