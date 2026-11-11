package dev.lumiere.ftc.internal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import com.qualcomm.hardware.lynx.LynxDcMotorController;
import com.qualcomm.hardware.lynx.LynxServoController;
import com.qualcomm.robotcore.hardware.CRServoImpl;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorController;
import com.qualcomm.robotcore.hardware.DcMotorImpl;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.HardwareDevice;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.hardware.ServoController;
import com.qualcomm.robotcore.hardware.ServoImpl;
import com.qualcomm.robotcore.hardware.configuration.typecontainers.MotorConfigurationType;
import com.qualcomm.robotcore.util.LastKnown;

import org.firstinspires.ftc.robotcore.external.navigation.Rotation;
import org.firstinspires.ftc.teamcode.lumieretest.TeamCode;
import org.junit.Test;

import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.Map;

/**
 * On a hub, a device's reading must be what its own getter would report, though it is read from the SDK's
 * hub driver records instead of the getter. Each case sets a real SDK device through a controller that
 * keeps what it is sent and reads it back through the device's getter. The device is then pointed at a
 * hub driver whose records hold those same values, as they would on a Control Hub, and read.
 */
public class DeviceOutputsTest {
    private static final int PORT = 1;

    @Test
    public void motorsReadAsTheirGetterReportsThem() throws Exception {
        // goBILDA's motor types are counter-clockwise, which inverts the direction the SDK drives them in.
        for (MotorConfigurationType type : new MotorConfigurationType[]{motorType(Rotation.CW), motorType(Rotation.CCW)}) {
            for (DcMotorSimple.Direction direction : DcMotorSimple.Direction.values()) {
                for (DcMotor.RunMode mode : new DcMotor.RunMode[]{DcMotor.RunMode.RUN_WITHOUT_ENCODER, DcMotor.RunMode.RUN_TO_POSITION}) {
                    for (double power : new double[]{0.6, -0.4}) {
                        Memory memory = new Memory();
                        DcMotorImpl motor = new DcMotorImpl(memory.motors(), PORT, direction, type);
                        motor.setMode(mode);
                        motor.setPower(power);
                        double expected = motor.getPower();
                        set(motor, "controller", lynxMotors(memory.power.get(PORT), memory.mode.get(PORT)));
                        assertEquals(type.getOrientation() + " " + direction + " " + mode + " " + power, expected, reading(motor), 1e-3);
                    }
                }
            }
        }
    }

    @Test
    public void continuousServosReadAsTheirGetterReportsThem() throws Exception {
        for (DcMotorSimple.Direction direction : DcMotorSimple.Direction.values()) {
            for (double power : new double[]{0.6, -1, 0.25}) {
                Memory memory = new Memory();
                CRServoImpl servo = new CRServoImpl(memory.servos(), PORT, direction);
                servo.setPower(power);
                double expected = servo.getPower();
                set(servo, "controller", lynxServos(memory.position.get(PORT)));
                assertEquals(direction + " " + power, expected, reading(servo), 1e-3);
            }
        }
    }

    @Test
    public void servosReadAsTheirGetterReportsThem() throws Exception {
        double[][] ranges = {{0, 1}, {0.2, 0.8}, {0.1, 0.5}};
        for (Servo.Direction direction : Servo.Direction.values()) {
            for (double[] range : ranges) {
                for (double position : new double[]{0.3, 0.75}) {
                    Memory memory = new Memory();
                    ServoImpl servo = new ServoImpl(memory.servos(), PORT, direction);
                    servo.scaleRange(range[0], range[1]);
                    servo.setPosition(position);
                    double expected = servo.getPosition();
                    set(servo, "controller", lynxServos(memory.position.get(PORT)));
                    assertEquals(direction + " " + range[0] + "-" + range[1] + " " + position, expected, reading(servo), 1e-3);
                }
            }
        }
    }

    @Test
    public void aDeviceTheOpModeHasNotSetIsLeftOut() throws Exception {
        DcMotorImpl motor = new DcMotorImpl(new Memory().motors(), PORT, DcMotorSimple.Direction.FORWARD, motorType(Rotation.CW));
        set(motor, "controller", lynxMotors(null, null));
        HardwareMap map = hardwareMap();
        map.put("intake", motor);
        assertFalse(DeviceOutputs.read(map).containsKey("intake"));
    }

    /** A motor type turning this way (the SDK's own unspecified type needs its native library). */
    private static MotorConfigurationType motorType(Rotation orientation) {
        MotorConfigurationType type = new MotorConfigurationType();
        type.setOrientation(orientation);
        return type;
    }

    /** The device's power or position as the robot library reads it from a hub. */
    private static double reading(HardwareDevice device) {
        HardwareMap map = hardwareMap();
        map.put("device", device);
        Map<?, ?> output = (Map<?, ?>) DeviceOutputs.read(map).get("device");
        Object value = output.containsKey("power") ? output.get("power") : output.get("position");
        return ((Number) value).doubleValue();
    }

    private static HardwareMap hardwareMap() {
        return new HardwareMap(null, null) {
            @Override
            public <T> T tryGet(Class<? extends T> type, String name) {
                return null;
            }
        };
    }

    /** A Control Hub motor driver whose record for {@link #PORT} holds this power and mode, or nothing for null. */
    private static LynxDcMotorController lynxMotors(Double power, DcMotor.RunMode mode) throws Exception {
        LynxDcMotorController controller = allocate(LynxDcMotorController.class);
        // Its records are made the same way: their constructor asks for a motor type, which needs the SDK's native library.
        Class<?> properties = Class.forName(LynxDcMotorController.class.getName() + "$MotorProperties");
        Object motors = Array.newInstance(properties, 4);
        for (int i = 0; i < 4; i++) {
            Object motor = allocate(properties);
            set(motor, "lastKnownPower", new LastKnown<Double>());
            set(motor, "lastKnownMode", new LastKnown<DcMotor.RunMode>());
            Array.set(motors, i, motor);
        }
        Object motor = Array.get(motors, PORT - LynxDcMotorController.apiMotorFirst);
        if (power != null) record(motor, "lastKnownPower").setValue(power);
        if (mode != null) record(motor, "lastKnownMode").setValue(mode);
        set(controller, "motors", motors);
        return controller;
    }

    /** A Control Hub servo driver whose record for {@link #PORT} holds this commanded position. */
    @SuppressWarnings("unchecked")
    private static LynxServoController lynxServos(double position) throws Exception {
        LynxServoController controller = allocate(LynxServoController.class);
        LastKnown<Double>[] commanded = new LastKnown[6];
        for (int i = 0; i < commanded.length; i++) commanded[i] = new LastKnown<>();
        commanded[PORT - LynxServoController.apiServoFirst].setValue(position);
        set(controller, "lastKnownCommandedPosition", commanded);
        return controller;
    }

    @SuppressWarnings("unchecked")
    private static LastKnown<Object> record(Object target, String name) throws Exception {
        Field field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return (LastKnown<Object>) field.get(target);
    }

    /** An instance made without running a constructor, as a driver would need a real hub for one. */
    private static <T> T allocate(Class<T> type) throws Exception {
        Field theUnsafe = Class.forName("sun.misc.Unsafe").getDeclaredField("theUnsafe");
        theUnsafe.setAccessible(true);
        Object unsafe = theUnsafe.get(null);
        return type.cast(unsafe.getClass().getMethod("allocateInstance", Class.class).invoke(unsafe, type));
    }

    private static void set(Object target, String name, Object value) throws Exception {
        for (Class<?> c = target.getClass(); c != null; c = c.getSuperclass()) {
            try {
                Field field = c.getDeclaredField(name);
                field.setAccessible(true);
                field.set(target, value);
                return;
            } catch (NoSuchFieldException e) {
                // Look in the superclass.
            }
        }
        throw new NoSuchFieldException(name);
    }

    /** Motor and servo controllers that keep what they are sent, by port. */
    private static final class Memory {
        final Map<Integer, Double> power = new HashMap<>();
        final Map<Integer, DcMotor.RunMode> mode = new HashMap<>();
        final Map<Integer, Double> position = new HashMap<>();

        DcMotorController motors() {
            return (DcMotorController) Proxy.newProxyInstance(DeviceOutputsTest.class.getClassLoader(), new Class<?>[]{DcMotorController.class}, (proxy, method, args) -> {
                switch (method.getName()) {
                    case "setMotorPower": power.put((Integer) args[0], (Double) args[1]); return null;
                    case "getMotorPower": return power.getOrDefault((Integer) args[0], 0.0);
                    case "setMotorMode": mode.put((Integer) args[0], (DcMotor.RunMode) args[1]); return null;
                    case "getMotorMode": return mode.getOrDefault((Integer) args[0], DcMotor.RunMode.RUN_WITHOUT_ENCODER);
                    default: return TeamCode.zero(method.getReturnType(), proxy, method.getName(), args);
                }
            });
        }

        ServoController servos() {
            return (ServoController) Proxy.newProxyInstance(DeviceOutputsTest.class.getClassLoader(), new Class<?>[]{ServoController.class}, (proxy, method, args) -> {
                switch (method.getName()) {
                    case "setServoPosition": position.put((Integer) args[0], (Double) args[1]); return null;
                    case "getServoPosition": return position.getOrDefault((Integer) args[0], 0.0);
                    default: return TeamCode.zero(method.getReturnType(), proxy, method.getName(), args);
                }
            });
        }
    }
}
