package dev.lumiere.ftc;

import com.qualcomm.robotcore.hardware.AnalogInput;
import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.ColorSensor;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorController;
import com.qualcomm.robotcore.hardware.DigitalChannel;
import com.qualcomm.robotcore.hardware.DistanceSensor;
import com.qualcomm.robotcore.hardware.HardwareDevice;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.IMU;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.hardware.ServoController;
import com.qualcomm.robotcore.hardware.TouchSensor;
import com.qualcomm.robotcore.hardware.VoltageSensor;

import dev.lumiere.ftc.internal.Json;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

/**
 * Describes the configured hardware and available OpModes so the app can offer matching names, and
 * which of the devices Pedro Pathing drives (see {@link PedroHardware}).
 */
public final class Manifest {
    /**
     * A device that states its own manifest type. The simulator uses it for configured hardware it
     * lists but does not simulate, such as an analog sensor or a team's own I2C driver.
     */
    public interface Typed {
        /** A short, lowercase type, such as {@code analog} or {@code camera}. */
        String manifestType();
    }

    /** Names in case-insensitive order; names that differ only in case are different devices, as on the hub. */
    private static final Comparator<String> BY_NAME = (a, b) -> {
        int order = String.CASE_INSENSITIVE_ORDER.compare(a, b);
        return order != 0 ? order : a.compareTo(b);
    };

    /** An OpMode listed on the Driver Station. */
    public static final class OpModeInfo {
        public final String name;
        public final String group;
        /** One of "autonomous", "teleop", or "utility". */
        public final String flavor;

        public OpModeInfo(String name, String group, String flavor) {
            this.name = name;
            this.group = group;
            this.flavor = flavor;
        }
    }

    private Manifest() {
    }

    /**
     * Builds the manifest message body. Controllers and hubs are omitted; devices are sorted by name.
     * When the team's Pedro constants are found, {@code pedro} names the devices Pedro Pathing drives.
     */
    public static Map<String, Object> build(HardwareMap hardwareMap, List<OpModeInfo> opModes) {
        Map<String, Map<String, Object>> devices = new TreeMap<>(BY_NAME);
        if (hardwareMap != null) {
            for (HardwareDevice device : hardwareMap.unsafeIterable()) {
                String type = typeOf(device);
                if (type == null) continue;
                for (String name : hardwareMap.getNamesOf(device)) {
                    Map<String, Object> entry = Json.object();
                    entry.put("name", name);
                    entry.put("type", type);
                    devices.put(name + "\0" + type, entry);
                }
            }
        }
        List<Object> opModeList = new ArrayList<>();
        if (opModes != null) {
            for (OpModeInfo info : opModes) {
                Map<String, Object> entry = Json.object();
                entry.put("name", info.name);
                entry.put("group", info.group);
                entry.put("flavor", info.flavor);
                opModeList.add(entry);
            }
        }
        Map<String, Object> body = Json.object();
        body.put("devices", new ArrayList<Object>(devices.values()));
        body.put("opModes", opModeList);
        Map<String, Object> pedro = pedro();
        if (pedro != null) body.put("pedro", pedro);
        return body;
    }

    /** What Pedro Pathing drives, or null. The manifest is still sent if the team's constants cannot be read. */
    private static Map<String, Object> pedro() {
        try {
            return PedroHardware.describe();
        } catch (RuntimeException | LinkageError e) {
            return null;
        }
    }

    /** A short, stable device category, or null for controllers and hubs that teams do not program directly. */
    public static String typeOf(HardwareDevice device) {
        if (device instanceof DcMotorController || device instanceof ServoController) return null;
        if (device instanceof Typed) {
            String type = ((Typed) device).manifestType();
            if (type != null && !type.trim().isEmpty()) return type.trim().toLowerCase(Locale.ROOT);
        }
        if (device instanceof DcMotor) return "motor";
        if (device instanceof CRServo) return "crservo";
        if (device instanceof Servo) return "servo";
        if (device instanceof IMU) return "imu";
        if (device instanceof VoltageSensor) return "voltage";
        if (device instanceof DigitalChannel) return "digital";
        if (device instanceof TouchSensor) return "touch";
        if (device instanceof ColorSensor) return "color";
        if (device instanceof DistanceSensor) return "distance";
        if (device instanceof AnalogInput) return "analog";
        String className = device.getClass().getSimpleName();
        if (className.contains("Pinpoint")) return "pinpoint";
        if (className.contains("OTOS")) return "otos";
        if (className.contains("OctoQuad")) return "octoquad";
        if (className.contains("Webcam") || className.contains("Camera")) return "camera";
        if (className.contains("Lynx") || className.contains("Hub")) return null;
        return className.toLowerCase(Locale.ROOT);
    }
}
