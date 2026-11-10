package dev.lumiere.ftc.live;

import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.HardwareDevice;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;

import dev.lumiere.ftc.Manifest;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Checks a program's mechanisms against the robot. Every device must be configured with the type the
 * program uses it as, and none may be one Pedro Pathing drives. Only the configuration is read: no
 * device is opened, and nothing moves. The app applies the same rules before it sends a program.
 */
final class HardwareCheck {
    static final class Result {
        /** Reasons the program cannot run on this robot. */
        final List<String> problems = new ArrayList<>();
        /** Things the team should know that don't stop the program. */
        final List<String> notes = new ArrayList<>();
    }

    private static final Set<String> DRIVE_ROLES = new HashSet<>(Arrays.asList("frontLeft", "frontRight", "backLeft", "backRight"));
    private static final Set<String> ENCODER_ROLES = new HashSet<>(Arrays.asList("leftEncoder", "rightEncoder", "strafeEncoder", "xPod", "yPod"));
    private static final Map<String, String> ROLE_LABELS = new HashMap<>();

    static {
        ROLE_LABELS.put("frontLeft", "front left drive motor");
        ROLE_LABELS.put("frontRight", "front right drive motor");
        ROLE_LABELS.put("backLeft", "back left drive motor");
        ROLE_LABELS.put("backRight", "back right drive motor");
        ROLE_LABELS.put("leftEncoder", "left dead wheel");
        ROLE_LABELS.put("rightEncoder", "right dead wheel");
        ROLE_LABELS.put("strafeEncoder", "strafe dead wheel");
        ROLE_LABELS.put("xPod", "forward dead wheel");
        ROLE_LABELS.put("yPod", "strafe dead wheel");
        ROLE_LABELS.put("imu", "localizer IMU");
        ROLE_LABELS.put("pinpoint", "Pinpoint localizer");
        ROLE_LABELS.put("otos", "OTOS localizer");
        ROLE_LABELS.put("octoquad", "OctoQuad localizer");
    }

    private HardwareCheck() {
    }

    /**
     * @param pedro    the manifest's {@code pedro} block for the team's constants, or null when unknown
     * @param powerCap the highest power Lumière Live gives a mechanism
     */
    static Result check(LiveProgram program, HardwareMap hardwareMap, Map<String, Object> pedro, double powerCap) {
        Result result = new Result();
        Map<String, List<HardwareDevice>> configured = configured(hardwareMap);
        Map<String, List<String>> pedroRoles = roles(pedro);
        for (LiveProgram.Mechanism mechanism : program.mechanisms) {
            for (LiveProgram.Device device : mechanism.devices) {
                String where = "\"" + device.name + "\" in " + mechanism.name;
                List<HardwareDevice> found = configured.get(device.name);
                Class<?> wanted = classFor(device.kind);
                if (found == null) {
                    result.problems.add(where + " is not in the robot's configuration.");
                } else if (!isAny(found, wanted)) {
                    String type = Manifest.typeOf(found.get(0));
                    result.problems.add(where + " is configured as " + (type == null ? "a controller" : type) + ", but the program uses it as " + label(device.kind) + ".");
                }

                boolean target = false;
                for (LiveProgram.State state : mechanism.states) {
                    LiveProgram.Output output = state.outputs.get(device.id);
                    if (output == null) continue;
                    if ("target".equals(output.kind)) target = true;
                    double power = "target".equals(output.kind) ? output.power : "power".equals(output.kind) ? Math.abs(output.value) : 0;
                    if (power > powerCap + 1e-9) {
                        result.notes.add(where + " runs at power " + format(power) + " in \"" + state.name + "\"; Lumière Live limits mechanisms to " + format(powerCap) + ".");
                    }
                }

                List<String> roles = pedroRoles.get(device.name);
                if (roles == null) continue;
                String drive = first(roles, DRIVE_ROLES);
                String wheel = first(roles, ENCODER_ROLES);
                if (drive != null) {
                    result.problems.add(where + " is Pedro Pathing's " + ROLE_LABELS.get(drive) + ". Lumière Live never gives Pedro's devices to mechanisms.");
                } else if (wheel != null && target) {
                    result.problems.add(where + " has Pedro Pathing's " + ROLE_LABELS.get(wheel) + " on its encoder port, so an encoder target would follow the dead wheel. Give this motor power instead.");
                } else if (wheel != null) {
                    result.notes.add(where + " shares its port with Pedro Pathing's " + ROLE_LABELS.get(wheel) + "; Lumière Live only sets its power.");
                } else if (!roles.isEmpty()) {
                    String role = roles.get(0);
                    String label = ROLE_LABELS.containsKey(role) ? ROLE_LABELS.get(role) : role;
                    result.problems.add(where + " is Pedro Pathing's " + label + ". Lumière Live never gives Pedro's devices to mechanisms.");
                }
            }
        }
        return result;
    }

    /** Every configured name and the devices behind it, read the way the manifest reads them. */
    static Map<String, List<HardwareDevice>> configured(HardwareMap hardwareMap) {
        Map<String, List<HardwareDevice>> configured = new HashMap<>();
        if (hardwareMap == null) return configured;
        for (HardwareDevice device : hardwareMap.unsafeIterable()) {
            for (String name : hardwareMap.getNamesOf(device)) {
                List<HardwareDevice> list = configured.get(name);
                if (list == null) configured.put(name, list = new ArrayList<>());
                list.add(device);
            }
        }
        return configured;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, List<String>> roles(Map<String, Object> pedro) {
        Map<String, List<String>> roles = new HashMap<>();
        Object devices = pedro == null ? null : pedro.get("devices");
        if (!(devices instanceof List)) return roles;
        for (Object item : (List<Object>) devices) {
            if (!(item instanceof Map)) continue;
            Object name = ((Map<String, Object>) item).get("name");
            Object role = ((Map<String, Object>) item).get("role");
            if (!(name instanceof String) || !(role instanceof String)) continue;
            List<String> list = roles.get(name);
            if (list == null) roles.put((String) name, list = new ArrayList<>());
            list.add((String) role);
        }
        return roles;
    }

    private static Class<?> classFor(String kind) {
        switch (kind) {
            case "servo": return Servo.class;
            case "crservo": return CRServo.class;
            default: return DcMotorEx.class;
        }
    }

    private static String label(String kind) {
        switch (kind) {
            case "servo": return "a servo";
            case "crservo": return "a continuous servo";
            default: return "a motor";
        }
    }

    private static boolean isAny(List<HardwareDevice> devices, Class<?> wanted) {
        for (HardwareDevice device : devices) if (wanted.isInstance(device)) return true;
        return false;
    }

    private static String first(List<String> roles, Set<String> set) {
        for (String role : roles) if (set.contains(role)) return role;
        return null;
    }

    static String format(double value) {
        return String.format(Locale.ROOT, "%.2f", value).replaceAll("0+$", "").replaceAll("\\.$", "");
    }
}
