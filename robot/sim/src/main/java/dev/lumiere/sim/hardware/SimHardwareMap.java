package dev.lumiere.sim.hardware;

import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DigitalChannel;
import com.qualcomm.robotcore.hardware.HardwareDevice;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.hardware.VoltageSensor;

import java.util.List;
import java.util.Map;

/**
 * The official {@link HardwareMap}, backed by simulated devices.
 *
 * <p>Only {@link #tryGet} is overridden. The SDK's version first checks whether it runs on a REV
 * Control Hub, which loads the SDK's native library; that check does not apply on a desktop.
 * Devices requested by type are created on first use, so OpModes run without a configuration file.
 */
public final class SimHardwareMap extends HardwareMap {
    private final SimHardware hardware;

    public SimHardwareMap(SimHardware hardware) {
        super(null, null);
        this.hardware = hardware;
        register("Control Hub", hardware.declare(VoltageSensor.class, "Control Hub"));
    }

    /** Registers already-declared simulator devices so typed mappings such as {@code dcMotor.get} find them. */
    public void registerDeclared() {
        for (Map.Entry<String, HardwareDevice> entry : hardware.devices().entrySet()) {
            if (!allDevicesMap.containsKey(entry.getKey())) register(entry.getKey(), entry.getValue());
        }
    }

    @Override
    public <T> T tryGet(Class<? extends T> classOrInterface, String deviceName) {
        synchronized (lock) {
            String name = deviceName.trim();
            List<HardwareDevice> list = allDevicesMap.get(name);
            if (list != null) {
                for (HardwareDevice device : list) {
                    if (classOrInterface.isInstance(device)) return classOrInterface.cast(device);
                }
            }
            HardwareDevice created = hardware.getOrCreate(classOrInterface, name);
            if (created == null || !classOrInterface.isInstance(created)) return null;
            if (list == null || !list.contains(created)) register(name, created);
            return classOrInterface.cast(created);
        }
    }

    private void register(String name, HardwareDevice device) {
        put(name, device);
        if (device instanceof DcMotor) dcMotor.put(name, (DcMotor) device);
        if (device instanceof Servo) servo.put(name, (Servo) device);
        if (device instanceof CRServo) crservo.put(name, (CRServo) device);
        if (device instanceof DigitalChannel) digitalChannel.put(name, (DigitalChannel) device);
        if (device instanceof VoltageSensor) voltageSensor.put(name, (VoltageSensor) device);
    }
}
