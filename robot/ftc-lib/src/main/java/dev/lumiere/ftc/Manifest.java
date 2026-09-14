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
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

/** Describes the configured hardware and available OpModes so the app can offer matching names. */
public final class Manifest {
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

    /** Builds the manifest message body. Controllers and hubs are omitted; devices are sorted by name. */
    public static Map<String, Object> build(HardwareMap hardwareMap, List<OpModeInfo> opModes) {
        Map<String, Map<String, Object>> devices = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
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
        return body;
    }

    /** A short, stable device category, or null for controllers and hubs that teams do not program directly. */
    public static String typeOf(HardwareDevice device) {
        if (device instanceof DcMotorController || device instanceof ServoController) return null;
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
        if (className.contains("Webcam") || className.contains("Camera")) return "camera";
        if (className.contains("Lynx") || className.contains("Hub")) return null;
        return className.toLowerCase(Locale.ROOT);
    }
}
