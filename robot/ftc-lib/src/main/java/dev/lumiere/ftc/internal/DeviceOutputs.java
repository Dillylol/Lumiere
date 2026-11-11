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
import java.lang.reflect.Method;
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
                Object motor = Array.get(field(controller, "motors"), port - first(controller, "apiMotorFirst"));
                Object power = known(field(motor, "lastKnownPower"));
                if (!(power instanceof Double)) return null;
                // As DcMotorImpl.getPower() turns it back: unsigned while running to a position, and otherwise in
                // the motor's operational direction, which a counter-clockwise motor type (goBILDA's) inverts.
                if (known(field(motor, "lastKnownMode")) == DcMotor.RunMode.RUN_TO_POSITION) return Math.abs((Double) power);
                return call(device, "getOperationalDirection") == DcMotorSimple.Direction.REVERSE ? -(Double) power : (Double) power;
            }
            if (!driver.startsWith(LYNX_SERVOS)) return null;
            Object commanded = known(Array.get(field(controller, "lastKnownCommandedPosition"), port - first(controller, "apiServoFirst")));
            if (!(commanded instanceof Double)) return null;
            double position = (Double) commanded;
            // A continuous servo's power is its position from -1 to 1 in its direction, as CRServoImpl turns it back.
            if ("crservo".equals(type)) {
                double power = position * 2 - 1;
                return ((DcMotorSimple) device).getDirection() == DcMotorSimple.Direction.REVERSE ? -power : power;
            }
            // As ServoImpl.getPosition() turns it back: out of the servo's scale range first, then in its direction.
            double min = (Double) field(device, "limitPositionMin"), max = (Double) field(device, "limitPositionMax");
            double unscaled = max > min ? (position - min) / (max - min) : position;
            double shown = ((Servo) device).getDirection() == Servo.Direction.REVERSE ? 1 - unscaled : unscaled;
            return Math.max(0, Math.min(1, shown));
        } catch (ReflectiveOperationException | ClassCastException | NullPointerException | IndexOutOfBoundsException e) {
            return null;
        }
    }

    /** A record's value, or null when the SDK has none. */
    @SuppressWarnings("unchecked")
    private static Object known(Object record) {
        return record instanceof LastKnown ? ((LastKnown<Object>) record).getNonTimedValue() : null;
    }

    /** A driver's first port number, or 0 when it doesn't say. */
    private static int first(Object controller, String name) {
        try {
            return controller.getClass().getField(name).getInt(null);
        } catch (ReflectiveOperationException | RuntimeException e) {
            return 0;
        }
    }

    /** Calls a method without arguments that the target's class or a superclass declares, public or not. */
    private static Object call(Object target, String name) throws ReflectiveOperationException {
        for (Class<?> c = target.getClass(); c != null; c = c.getSuperclass()) {
            try {
                Method method = c.getDeclaredMethod(name);
                method.setAccessible(true);
                return method.invoke(target);
            } catch (NoSuchMethodException e) {
                // Look in the superclass.
            }
        }
        throw new NoSuchMethodException(name);
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
