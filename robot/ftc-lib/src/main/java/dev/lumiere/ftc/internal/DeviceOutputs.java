package dev.lumiere.ftc.internal;

import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.HardwareDevice;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.util.LastKnown;

import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.util.Map;

/**
 * The outputs an OpMode last gave its motors, servos and continuous servos, read without asking the
 * hub, so reading them from another thread never slows the OpMode: a hub device's value comes from the
 * SDK's own record of what it last sent, and a device without one yet is left out. Simulated devices
 * report through their getters, which are cheap.
 *
 * <p>The SDK keeps that record in its hub drivers, which aren't public, so they are read by reflection.
 * When an SDK version shapes them differently, its hub devices are left out instead of being asked.
 */
public final class DeviceOutputs {
    private static final String LYNX_MOTORS = "com.qualcomm.hardware.lynx.LynxDcMotorController";
    private static final String LYNX_SERVOS = "com.qualcomm.hardware.lynx.LynxServoController";

    private DeviceOutputs() {
    }

    /** Every motor's and continuous servo's power and every servo's position, by configured name, as the protocol's device reports. */
    public static Map<String, Object> read(HardwareMap hardwareMap) {
        Map<String, Object> outputs = Json.object();
        if (hardwareMap == null) return outputs;
        for (HardwareDevice device : hardwareMap.getAll(HardwareDevice.class)) {
            String type = device instanceof DcMotor ? "motor" : device instanceof CRServo ? "crservo" : device instanceof Servo ? "servo" : null;
            if (type == null) continue;
            Double value;
            try {
                value = device.getClass().getName().startsWith("com.qualcomm.") ? recorded(device, type) : own(device, type);
            } catch (RuntimeException | LinkageError e) {
                value = null;
            }
            if (value == null || value.isNaN()) continue;
            Map<String, Object> output = Json.object();
            output.put("type", type);
            output.put("servo".equals(type) ? "position" : "power", Math.round(value * 1000.0) / 1000.0);
            for (String name : hardwareMap.getNamesOf(device)) outputs.put(name, output);
        }
        return outputs;
    }

    private static Double own(HardwareDevice device, String type) {
        return "servo".equals(type) ? ((Servo) device).getPosition() : ((DcMotorSimple) device).getPower();
    }

    /** What the SDK last sent a hub device, as its getter would report it, or null when it has no record. */
    private static Double recorded(HardwareDevice device, String type) {
        try {
            Object controller = field(device, "controller");
            int port = (Integer) field(device, "portNumber");
            String driver = controller == null ? "" : controller.getClass().getName();
            if ("motor".equals(type)) {
                if (!driver.startsWith(LYNX_MOTORS)) return null;
                Double power = known(field(Array.get(field(controller, "motors"), port - first(controller, "apiMotorFirst")), "lastKnownPower"));
                return power == null ? null : signed(device, power);
            }
            if (!driver.startsWith(LYNX_SERVOS)) return null;
            Double position = known(Array.get(field(controller, "lastKnownCommandedPosition"), port - first(controller, "apiServoFirst")));
            if (position == null) return null;
            // A continuous servo's power is its position from -1 to 1, as CRServoImpl turns it back.
            if ("crservo".equals(type)) return signed(device, position * 2 - 1);
            double shown = ((Servo) device).getDirection() == Servo.Direction.REVERSE ? 1 - position : position;
            double min = (Double) field(device, "limitPositionMin"), max = (Double) field(device, "limitPositionMax");
            return max > min ? Math.max(0, Math.min(1, (shown - min) / (max - min))) : shown;
        } catch (ReflectiveOperationException | ClassCastException | NullPointerException | IndexOutOfBoundsException e) {
            return null;
        }
    }

    private static double signed(HardwareDevice device, double power) {
        return ((DcMotorSimple) device).getDirection() == DcMotorSimple.Direction.REVERSE ? -power : power;
    }

    @SuppressWarnings("unchecked")
    private static Double known(Object record) {
        Object value = record instanceof LastKnown ? ((LastKnown<Object>) record).getNonTimedValue() : null;
        return value instanceof Double ? (Double) value : null;
    }

    /** A driver's first port number, or 0 when it doesn't say. */
    private static int first(Object controller, String name) {
        try {
            return controller.getClass().getField(name).getInt(null);
        } catch (ReflectiveOperationException | RuntimeException e) {
            return 0;
        }
    }

    private static Object field(Object target, String name) throws ReflectiveOperationException {
        for (Class<?> c = target.getClass(); c != null; c = c.getSuperclass()) {
            try {
                Field field = c.getDeclaredField(name);
                field.setAccessible(true);
                return field.get(target);
            } catch (NoSuchFieldException e) {
                // Look in the superclass.
            }
        }
        throw new NoSuchFieldException(name);
    }
}
