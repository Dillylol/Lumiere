package dev.lumiere.devtools.virtualhub;

import static org.junit.Assume.assumeTrue;

import org.junit.Test;

/**
 * Entry point for dev/virtual-hardware/virtual-hub.mjs. The init script adds this directory to a
 * robot project's unit tests only for that run; it is skipped unless the script launched it.
 */
public class RunVirtualHub {
    @Test
    public void run() throws Exception {
        assumeTrue("Started by dev/virtual-hardware", System.getProperty(VirtualControlHub.DS_PORT_PROPERTY) != null);
        VirtualControlHub.runFromSystemProperties();
    }
}
