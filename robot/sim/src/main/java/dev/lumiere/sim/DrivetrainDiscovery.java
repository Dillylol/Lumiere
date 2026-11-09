package dev.lumiere.sim;

import com.qualcomm.robotcore.hardware.DcMotorSimple;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.function.Supplier;

/**
 * Reads the drivetrain from the team's Pedro Pathing constants: drive motor names and wiring, and the
 * speeds and decelerations Pedro's tuners measured. The simulator then uses the same hardware names
 * the robot code expects and moves the way the robot moves. Reflection keeps the simulator
 * independent of the Pedro Pathing version. When no constants are found, the FTC SDK sample names and
 * the simulator's own motor model are used.
 */
public final class DrivetrainDiscovery {
    public static final String DEFAULT_CONSTANTS_CLASS = "org.firstinspires.ftc.teamcode.pedro.Constants";

    /** Names and directions of the drivetrain hardware. */
    public static final class Drivetrain {
        public String frontLeft = "left_front_drive";
        public String frontRight = "right_front_drive";
        public String backLeft = "left_back_drive";
        public String backRight = "right_back_drive";
        public DcMotorSimple.Direction frontLeftDirection = DcMotorSimple.Direction.REVERSE;
        public DcMotorSimple.Direction frontRightDirection = DcMotorSimple.Direction.FORWARD;
        public DcMotorSimple.Direction backLeftDirection = DcMotorSimple.Direction.REVERSE;
        public DcMotorSimple.Direction backRightDirection = DcMotorSimple.Direction.FORWARD;
        /** The Pinpoint name, or null when the robot does not use one. */
        public String pinpoint = "pinpoint";
        /** Where the values came from, shown to the user. */
        public String source = "FTC SDK sample names";
        /**
         * What Pedro Pathing's tuners measured (ForesightConfig): top speeds at full power, in inches per
         * second, and coasting decelerations, in inches per second squared. NaN when not set.
         */
        public double forwardVelocity = Double.NaN;
        public double strafeVelocity = Double.NaN;
        public double forwardDeceleration = Double.NaN;
        public double strafeDeceleration = Double.NaN;
    }

    private DrivetrainDiscovery() {
    }

    public static Drivetrain discover(String constantsClassName) {
        Drivetrain result = new Drivetrain();
        Class<?> constants;
        try {
            constants = Class.forName(constantsClassName, true, DrivetrainDiscovery.class.getClassLoader());
        } catch (ClassNotFoundException | LinkageError e) {
            return result;
        }
        boolean found = false;
        for (Field field : constants.getDeclaredFields()) {
            if (!Modifier.isStatic(field.getModifiers())) continue;
            String typeName = field.getType().getSimpleName();
            Object config;
            try {
                field.setAccessible(true);
                config = field.get(null);
            } catch (ReflectiveOperationException | RuntimeException e) {
                continue;
            }
            if (config == null) continue;
            if (typeName.equals("MecanumConfig")) {
                result.frontLeft = string(config, "frontLeftName", result.frontLeft);
                result.frontRight = string(config, "frontRightName", result.frontRight);
                result.backLeft = string(config, "backLeftName", result.backLeft);
                result.backRight = string(config, "backRightName", result.backRight);
                result.frontLeftDirection = direction(config, "frontLeftDirection", result.frontLeftDirection);
                result.frontRightDirection = direction(config, "frontRightDirection", result.frontRightDirection);
                result.backLeftDirection = direction(config, "backLeftDirection", result.backLeftDirection);
                result.backRightDirection = direction(config, "backRightDirection", result.backRightDirection);
                found = true;
            } else if (typeName.equals("PinpointConfig")) {
                result.pinpoint = string(config, "name", result.pinpoint);
                found = true;
            } else if (typeName.equals("ForesightConfig")) {
                result.forwardVelocity = magnitude(config, "maxAchievableForwardVelocity");
                result.strafeVelocity = magnitude(config, "maxAchievableStrafeVelocity");
                result.forwardDeceleration = magnitude(config, "naturalForwardDeceleration");
                result.strafeDeceleration = magnitude(config, "naturalStrafeDeceleration");
                found = true;
            } else if (typeName.endsWith("LocalizerConfig") || typeName.equals("OTOSConfig") || typeName.equals("TwoWheelConfig")
                    || typeName.equals("ThreeWheelConfig") || typeName.equals("ThreeWheelIMUConfig") || typeName.equals("OctoQuadConfig")) {
                result.pinpoint = null;
            }
        }
        if (found) result.source = constants.getName();
        return result;
    }

    private static Object configValue(Object config, String name) {
        try {
            Field field = config.getClass().getField(name);
            Object holder = field.get(config);
            if (holder instanceof Supplier) return ((Supplier<?>) holder).get();
        } catch (ReflectiveOperationException | RuntimeException e) {
            // The value is not set or the field does not exist in this Pedro Pathing version.
        }
        return null;
    }

    private static String string(Object config, String name, String fallback) {
        Object value = configValue(config, name);
        return value instanceof String ? (String) value : fallback;
    }

    /** A positive, finite measurement, or NaN. Pedro may store decelerations with either sign. */
    private static double magnitude(Object config, String name) {
        Object value = configValue(config, name);
        if (!(value instanceof Number)) return Double.NaN;
        double magnitude = Math.abs(((Number) value).doubleValue());
        return magnitude > 0 && !Double.isInfinite(magnitude) ? magnitude : Double.NaN;
    }

    private static DcMotorSimple.Direction direction(Object config, String name, DcMotorSimple.Direction fallback) {
        Object value = configValue(config, name);
        return value instanceof DcMotorSimple.Direction ? (DcMotorSimple.Direction) value : fallback;
    }
}
