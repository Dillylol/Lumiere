package dev.lumiere.sim;

import com.qualcomm.robotcore.hardware.DcMotorSimple;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.function.Supplier;

/**
 * Reads drive motor and localizer names from the team's Pedro Pathing constants, so the simulator
 * uses the same hardware names and wiring the robot code expects. Reflection keeps the simulator
 * independent of the Pedro Pathing version. When no constants are found, the FTC SDK sample names are
 * used.
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

    private static DcMotorSimple.Direction direction(Object config, String name, DcMotorSimple.Direction fallback) {
        Object value = configValue(config, name);
        return value instanceof DcMotorSimple.Direction ? (DcMotorSimple.Direction) value : fallback;
    }
}
