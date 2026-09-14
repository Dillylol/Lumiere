package dev.lumiere.sim.hardware;

import com.qualcomm.robotcore.hardware.AnalogInput;
import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.ColorSensor;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.DigitalChannel;
import com.qualcomm.robotcore.hardware.DistanceSensor;
import com.qualcomm.robotcore.hardware.HardwareDevice;
import com.qualcomm.robotcore.hardware.IMU;
import com.qualcomm.robotcore.hardware.NormalizedColorSensor;
import com.qualcomm.robotcore.hardware.NormalizedRGBA;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.hardware.TouchSensor;
import com.qualcomm.robotcore.hardware.VoltageSensor;

import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.AngularVelocity;
import org.firstinspires.ftc.robotcore.external.navigation.AxesOrder;
import org.firstinspires.ftc.robotcore.external.navigation.AxesReference;
import org.firstinspires.ftc.robotcore.external.navigation.CurrentUnit;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.Orientation;
import org.firstinspires.ftc.robotcore.external.navigation.Quaternion;
import org.firstinspires.ftc.robotcore.external.navigation.YawPitchRollAngles;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Every simulated device on the robot, keyed by configuration name.
 *
 * <p>Devices implement the FTC SDK's hardware interfaces through dynamic proxies, so methods the
 * simulator does not model return harmless defaults instead of failing to compile when a new SDK
 * adds interface methods.
 */
public final class SimHardware {
    /** Read by the simulated IMU, Pinpoint, and voltage sensors. Updated by the physics model. */
    public interface Body {
        double x();

        double y();

        double heading();

        double vx();

        double vy();

        double omega();

        void teleport(double x, double y, double heading);

        double batteryVolts();
    }

    private final Body body;
    private final Map<String, MotorState> motors = new LinkedHashMap<>();
    private final Map<String, ServoState> servos = new LinkedHashMap<>();
    private final Map<String, HardwareDevice> devices = new LinkedHashMap<>();
    private final Map<String, String> types = new LinkedHashMap<>();

    public SimHardware(Body body) {
        this.body = body;
    }

    public Body body() {
        return body;
    }

    /** Returns the device for a hardware-map request, creating it when the type is supported. */
    public synchronized HardwareDevice getOrCreate(Class<?> requested, String name) {
        HardwareDevice existing = devices.get(name);
        if (existing != null) return requested.isInstance(existing) ? existing : null;
        HardwareDevice created = create(requested, name);
        if (created != null) devices.put(name, created);
        return created;
    }

    public synchronized Map<String, HardwareDevice> devices() {
        return new LinkedHashMap<>(devices);
    }

    public synchronized MotorState motor(String name) {
        return motors.get(name);
    }

    public synchronized List<MotorState> motors() {
        return new ArrayList<>(motors.values());
    }

    public synchronized List<ServoState> servos() {
        return new ArrayList<>(servos.values());
    }

    public synchronized String typeOf(String name) {
        return types.get(name);
    }

    /** Advances motors that are not part of the drivetrain. */
    public void step(double seconds) {
        for (MotorState motor : motors()) motor.step(seconds);
    }

    private HardwareDevice create(Class<?> requested, String name) {
        if (requested == HardwareDevice.class) return null;
        if (requested.isAssignableFrom(DcMotorEx.class)) return motorDevice(name);
        if (requested.isAssignableFrom(CRServo.class) && requested != DcMotorSimple.class) return crServo(name);
        if (requested.isAssignableFrom(Servo.class)) return servo(name);
        if (requested.isAssignableFrom(IMU.class)) return imu(name);
        if (requested.isAssignableFrom(VoltageSensor.class)) return voltageSensor(name);
        if (requested.isAssignableFrom(DigitalChannel.class)) return digitalChannel(name);
        if (requested.isAssignableFrom(TouchSensor.class)) return constant(TouchSensor.class, name, "touch");
        if (requested.isAssignableFrom(DistanceSensor.class)) return constant(DistanceSensor.class, name, "distance");
        if (requested.isAssignableFrom(NormalizedColorSensor.class)) return constant(NormalizedColorSensor.class, name, "color");
        if (requested.isAssignableFrom(ColorSensor.class)) return constant(ColorSensor.class, name, "color");
        if (requested.isAssignableFrom(AnalogInput.class)) return null;
        if (com.qualcomm.hardware.gobilda.GoBildaPinpointDriver.class.isAssignableFrom(requested)) {
            types.put(name, "pinpoint");
            return new SimPinpoint(body);
        }
        return null;
    }

    /** Registers a motor ahead of time, for example a drive motor discovered from the constants. */
    public synchronized MotorState declareMotor(String name) {
        HardwareDevice device = devices.get(name);
        if (device == null) {
            device = motorDevice(name);
            devices.put(name, device);
        }
        return motors.get(name);
    }

    /** Registers a device of the given interface ahead of time so typed hardware-map lookups find it. */
    public synchronized HardwareDevice declare(Class<?> type, String name) {
        return getOrCreate(type, name);
    }

    private DcMotorEx motorDevice(String name) {
        MotorState state = new MotorState(name);
        motors.put(name, state);
        types.put(name, "motor");
        return proxy(DcMotorEx.class, name, (proxy, method, args) -> {
            switch (method.getName()) {
                case "setPower": state.power = (Double) args[0]; return null;
                case "getPower": return state.power;
                case "setDirection": state.direction = (DcMotorSimple.Direction) args[0]; return null;
                case "getDirection": return state.direction;
                case "setZeroPowerBehavior": state.zeroPowerBehavior = (DcMotor.ZeroPowerBehavior) args[0]; return null;
                case "getZeroPowerBehavior": return state.zeroPowerBehavior;
                case "getPowerFloat": return Math.abs(state.power) < 1e-9 && state.zeroPowerBehavior == DcMotor.ZeroPowerBehavior.FLOAT;
                case "setMode": state.setMode((DcMotor.RunMode) args[0]); return null;
                case "getMode": return state.mode;
                case "setTargetPosition": state.targetPosition = (Integer) args[0]; return null;
                case "getTargetPosition": return state.targetPosition;
                case "setTargetPositionTolerance": state.targetTolerance = (Integer) args[0]; return null;
                case "getTargetPositionTolerance": return state.targetTolerance;
                case "isBusy": return state.isBusy();
                case "getCurrentPosition": return state.currentPosition();
                case "getVelocity":
                    if (args == null) return state.velocityTicksPerSecond();
                    return ((AngleUnit) args[0]).fromRadians(state.velocityTicksPerSecond() / state.ticksPerRev * 2 * Math.PI);
                case "setVelocity": {
                    double ticksPerSecond = args.length == 1 ? (Double) args[0]
                            : ((AngleUnit) args[1]).toRadians((Double) args[0]) / (2 * Math.PI) * state.ticksPerRev;
                    state.power = ticksPerSecond / (state.freeRpm / 60.0 * state.ticksPerRev);
                    return null;
                }
                case "getCurrent": return ((CurrentUnit) args[0]).convert(Math.abs(state.appliedPower()) * 4.0, CurrentUnit.AMPS);
                case "setMotorEnable": state.enabled = true; return null;
                case "setMotorDisable": state.enabled = false; return null;
                case "isMotorEnabled": return state.enabled;
                case "isOverCurrent": return false;
                default: return null;
            }
        });
    }

    private Servo servo(String name) {
        ServoState state = new ServoState(name, false);
        servos.put(name, state);
        types.put(name, "servo");
        return proxy(Servo.class, name, (proxy, method, args) -> {
            switch (method.getName()) {
                case "setPosition": state.setPosition((Double) args[0]); return null;
                case "getPosition": return state.position();
                case "setDirection": state.direction = (Servo.Direction) args[0]; return null;
                case "getDirection": return state.direction;
                case "scaleRange": {
                    double min = (Double) args[0];
                    double max = (Double) args[1];
                    if (min < 0 || max > 1 || min >= max) throw new IllegalArgumentException("scaleRange requires 0 <= min < max <= 1");
                    state.scaleMin = min;
                    state.scaleMax = max;
                    return null;
                }
                default: return null;
            }
        });
    }

    private CRServo crServo(String name) {
        ServoState state = new ServoState(name, true);
        servos.put(name, state);
        types.put(name, "crservo");
        return proxy(CRServo.class, name, (proxy, method, args) -> {
            switch (method.getName()) {
                case "setPower": state.power = (Double) args[0]; return null;
                case "getPower": return state.power;
                case "setDirection": state.crDirection = (DcMotorSimple.Direction) args[0]; return null;
                case "getDirection": return state.crDirection;
                default: return null;
            }
        });
    }

    private IMU imu(String name) {
        types.put(name, "imu");
        final double[] yawOffset = {0};
        return proxy(IMU.class, name, (proxy, method, args) -> {
            switch (method.getName()) {
                case "initialize": return true;
                case "resetYaw": yawOffset[0] = body.heading(); return null;
                case "getRobotYawPitchRollAngles":
                    return new YawPitchRollAngles(AngleUnit.RADIANS, AngleUnit.normalizeRadians(body.heading() - yawOffset[0]), 0, 0, System.nanoTime());
                case "getRobotAngularVelocity": {
                    AngleUnit unit = (AngleUnit) args[0];
                    return new AngularVelocity(unit, 0f, 0f, (float) unit.fromRadians(body.omega()), System.nanoTime());
                }
                case "getRobotOrientation": {
                    AxesReference reference = (AxesReference) args[0];
                    AxesOrder order = (AxesOrder) args[1];
                    AngleUnit unit = (AngleUnit) args[2];
                    float yaw = (float) unit.fromRadians(AngleUnit.normalizeRadians(body.heading() - yawOffset[0]));
                    return new Orientation(reference, order, unit, yaw, 0f, 0f, System.nanoTime());
                }
                case "getRobotOrientationAsQuaternion": {
                    double half = AngleUnit.normalizeRadians(body.heading() - yawOffset[0]) / 2;
                    return new Quaternion((float) Math.cos(half), 0f, 0f, (float) Math.sin(half), System.nanoTime());
                }
                default: return null;
            }
        });
    }

    private VoltageSensor voltageSensor(String name) {
        types.put(name, "voltage");
        return proxy(VoltageSensor.class, name, (proxy, method, args) ->
                "getVoltage".equals(method.getName()) ? body.batteryVolts() : null);
    }

    private DigitalChannel digitalChannel(String name) {
        types.put(name, "digital");
        final boolean[] state = {true};
        final DigitalChannel.Mode[] mode = {DigitalChannel.Mode.INPUT};
        return proxy(DigitalChannel.class, name, (proxy, method, args) -> {
            switch (method.getName()) {
                case "getState": return state[0];
                case "setState": state[0] = (Boolean) args[0]; return null;
                case "getMode": return mode[0];
                case "setMode": mode[0] = (DigitalChannel.Mode) args[0]; return null;
                default: return null;
            }
        });
    }

    private <T extends HardwareDevice> T constant(Class<T> type, String name, String typeName) {
        types.put(name, typeName);
        return proxy(type, name, (proxy, method, args) -> {
            switch (method.getName()) {
                case "getDistance": return DistanceSensor.distanceOutOfRange;
                case "isPressed": return false;
                case "getValue": return 0.0;
                case "getNormalizedColors": return new NormalizedRGBA();
                default: return null;
            }
        });
    }

    @SuppressWarnings("unchecked")
    private <T extends HardwareDevice> T proxy(Class<T> type, String name, InvocationHandler behavior) {
        return (T) Proxy.newProxyInstance(SimHardware.class.getClassLoader(), new Class<?>[]{type}, (proxy, method, args) -> {
            switch (method.getName()) {
                case "hashCode": return System.identityHashCode(proxy);
                case "equals": return proxy == args[0];
                case "toString": return "Simulated " + type.getSimpleName() + " \"" + name + "\"";
                case "getDeviceName": return "Simulated " + type.getSimpleName();
                case "getConnectionInfo": return "Simulator";
                case "getVersion": return 1;
                case "getManufacturer": return HardwareDevice.Manufacturer.Other;
                default: break;
            }
            Object result = behavior.invoke(proxy, method, args);
            return result != null ? result : defaultValue(method);
        });
    }

    static Object defaultValue(Method method) {
        Class<?> type = method.getReturnType();
        if (type == boolean.class) return false;
        if (type == int.class) return 0;
        if (type == long.class) return 0L;
        if (type == double.class) return 0.0;
        if (type == float.class) return 0f;
        if (type == short.class) return (short) 0;
        if (type == byte.class) return (byte) 0;
        if (type == char.class) return (char) 0;
        return null;
    }
}
