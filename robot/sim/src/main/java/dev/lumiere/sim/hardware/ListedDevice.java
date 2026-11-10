package dev.lumiere.sim.hardware;

import com.qualcomm.robotcore.hardware.HardwareDevice;

import dev.lumiere.ftc.Manifest;

/**
 * A configured device the simulator lists but does not simulate. It reports its configured type in
 * the manifest, and it is never handed to OpModes: a lookup by type finds nothing, as it would for
 * any device the simulator cannot create.
 */
final class ListedDevice implements HardwareDevice, Manifest.Typed {
    private final String type;

    ListedDevice(String type) {
        this.type = type;
    }

    @Override
    public String manifestType() {
        return type;
    }

    @Override
    public Manufacturer getManufacturer() {
        return Manufacturer.Other;
    }

    @Override
    public String getDeviceName() {
        return "Listed, not simulated (" + type + ")";
    }

    @Override
    public String getConnectionInfo() {
        return "Lumière simulator";
    }

    @Override
    public int getVersion() {
        return 1;
    }

    @Override
    public void resetDeviceConfigurationForOpMode() {
    }

    @Override
    public void close() {
    }
}
