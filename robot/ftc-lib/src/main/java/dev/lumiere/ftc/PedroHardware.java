package dev.lumiere.ftc;

import dev.lumiere.ftc.internal.Json;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Supplier;

/**
 * The hardware Pedro Pathing drives on this robot, read from the team's Pedro constants class: the
 * drive motors and every device the localizer uses. The manifest reports it so the app knows which
 * configured devices belong to Pedro Pathing.
 *
 * <p>A device's role is Pedro's own setting name without "Name": {@code frontLeft} from
 * {@code MecanumConfig.frontLeftName}, {@code leftEncoder} from {@code ThreeWheelConfig.leftEncoderName},
 * {@code xPod} from {@code TwoWheelConfig.xPodName}. A localizer set up with a single device, such as
 * {@code PinpointConfig.name}, gives that device the localizer's kind as its role ({@code pinpoint}).
 * Settings that are not set are left out. Reflection keeps the library independent of the Pedro
 * Pathing version.
 */
public final class PedroHardware {
    /** Where Lumière's quickstart and Pedro Pathing's quickstart keep the constants class. */
    public static final String[] DEFAULT_CONSTANTS_CLASSES = {
            "org.firstinspires.ftc.teamcode.pedro.Constants",
            "org.firstinspires.ftc.teamcode.pedroPathing.Constants",
    };
    private static final String PEDRO_PACKAGE = "com.pedropathing.";
    private static final String CONFIG = "Config";

    private static volatile String constantsClass;

    private PedroHardware() {
    }

    /**
     * Names the team's constants class, for a project that keeps it somewhere other than
     * {@link #DEFAULT_CONSTANTS_CLASSES}. The simulator calls this with the class the app found.
     * Null restores the default places.
     */
    public static void useConstants(String className) {
        constantsClass = className == null || className.trim().isEmpty() ? null : className.trim();
    }

    /**
     * The manifest's {@code pedro} block: the constants class, the localizer's kind, and each device
     * with its role. Null when no constants class with Pedro Pathing hardware settings is found.
     */
    public static Map<String, Object> describe() {
        String chosen = constantsClass;
        if (chosen != null) return describe(load(chosen));
        for (String name : DEFAULT_CONSTANTS_CLASSES) {
            Map<String, Object> found = describe(load(name));
            if (found != null) return found;
        }
        return null;
    }

    /** The {@code pedro} block for one constants class, or null when it holds no Pedro hardware settings. */
    public static Map<String, Object> describe(Class<?> constants) {
        if (constants == null || !holdsPedroConfigs(constants)) return null;
        List<Object> devices = new ArrayList<>();
        String localizer = null;
        for (Field field : constants.getDeclaredFields()) {
            if (!Modifier.isStatic(field.getModifiers())) continue;
            Object config;
            try {
                field.setAccessible(true);
                config = field.get(null);
            } catch (ReflectiveOperationException | RuntimeException | LinkageError e) {
                continue;
            }
            if (!isPedroConfig(config == null ? null : config.getClass())) continue;
            String type = config.getClass().getSimpleName();
            String kind = type.substring(0, type.length() - CONFIG.length()).toLowerCase(Locale.ROOT);
            boolean isLocalizer = config.getClass().getName().contains(".localizers.");
            if (isLocalizer && localizer == null) localizer = kind;
            for (Field setting : config.getClass().getFields()) {
                String name = setting.getName();
                String role;
                if (name.equals("name")) {
                    // Pedro's localizers name their one device "name"; elsewhere it is a label, such as a swerve pod's.
                    if (!isLocalizer) continue;
                    role = kind;
                } else if (name.endsWith("Name") && name.length() > "Name".length()) {
                    role = name.substring(0, name.length() - "Name".length());
                } else {
                    continue;
                }
                String device = setting(config, setting);
                if (device == null) continue;
                Map<String, Object> entry = Json.object();
                entry.put("name", device);
                entry.put("role", role);
                devices.add(entry);
            }
        }
        if (devices.isEmpty() && localizer == null) return null;
        Map<String, Object> body = Json.object();
        body.put("constants", constants.getName());
        body.put("localizer", localizer);
        body.put("devices", devices);
        return body;
    }

    /** Loads a class without running its static initializer. */
    private static Class<?> load(String name) {
        try {
            return Class.forName(name, false, PedroHardware.class.getClassLoader());
        } catch (ClassNotFoundException | LinkageError | RuntimeException e) {
            return null;
        }
    }

    /**
     * True when a static field is declared as a Pedro Pathing config. Declared types are read without
     * initializing the class, so a class that is not Pedro constants is never initialized here.
     */
    private static boolean holdsPedroConfigs(Class<?> constants) {
        try {
            for (Field field : constants.getDeclaredFields()) {
                if (Modifier.isStatic(field.getModifiers()) && isPedroConfig(field.getType())) return true;
            }
        } catch (LinkageError | RuntimeException e) {
            return false;
        }
        return false;
    }

    private static boolean isPedroConfig(Class<?> type) {
        return type != null && type.getName().startsWith(PEDRO_PACKAGE) && type.getSimpleName().endsWith(CONFIG)
                && type.getSimpleName().length() > CONFIG.length();
    }

    /** A setting's device name, trimmed as the FTC SDK trims it, or null when it is not set. */
    private static String setting(Object config, Field setting) {
        try {
            Object holder = setting.get(config);
            Object value = holder instanceof Supplier ? ((Supplier<?>) holder).get() : null;
            if (!(value instanceof String)) return null;
            String name = ((String) value).trim();
            return name.isEmpty() ? null : name;
        } catch (ReflectiveOperationException | RuntimeException | LinkageError e) {
            // Pedro Pathing throws for a required setting that was never set.
            return null;
        }
    }
}
