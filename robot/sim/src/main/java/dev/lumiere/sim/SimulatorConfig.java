package dev.lumiere.sim;

import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DigitalChannel;
import com.qualcomm.robotcore.hardware.DistanceSensor;
import com.qualcomm.robotcore.hardware.IMU;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.hardware.TouchSensor;

import dev.lumiere.ftc.internal.Json;
import dev.lumiere.sim.hardware.SimHardware;
import dev.lumiere.sim.physics.RobotParameters;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/** Simulator settings, read from an optional JSON file. Every field has a working default. */
public final class SimulatorConfig {
    /**
     * A device to create before any OpMode runs, so typed hardware-map lookups find it. A type the
     * simulator cannot simulate, such as {@code analog}, {@code camera} or a team's own driver, is
     * listed in the manifest only: lookups for it find nothing.
     */
    public static final class Device {
        public final String name;
        /** The FTC SDK interface the simulator creates, or null for a device that is only listed. */
        public final Class<?> type;
        /** The manifest type of a device that is only listed, or null. */
        public final String listedType;

        Device(String name, Class<?> type, String listedType) {
            this.name = name;
            this.type = type;
            this.listedType = listedType;
        }

        /** Creates the device in the simulated hardware, or lists it when the simulator cannot simulate it. */
        public void declareIn(SimHardware hardware) {
            if (type != null) hardware.declare(type, name);
            else hardware.list(name, listedType);
        }
    }

    /** Device types are short lowercase words, as the manifest reports them. */
    private static final Pattern LISTED_TYPE = Pattern.compile("[a-z][a-z0-9_]{0,39}");

    public String packagePrefix = "org.firstinspires.ftc.teamcode";
    public String constantsClass = DrivetrainDiscovery.DEFAULT_CONSTANTS_CLASS;
    public double startX = 72;
    public double startY = 72;
    public double startHeading = Math.PI / 2;
    public final RobotParameters robot = new RobotParameters();
    public final List<Device> devices = new ArrayList<>();

    public static SimulatorConfig load(Path file) throws IOException {
        SimulatorConfig config = new SimulatorConfig();
        if (file == null) return config;
        String text = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
        Map<String, Object> root = Json.parseObject(text);
        if (root == null) throw new IOException("Simulator configuration must be a JSON object: " + file);
        config.apply(root);
        return config;
    }

    @SuppressWarnings("unchecked")
    void apply(Map<String, Object> root) {
        packagePrefix = Json.string(root, "package", packagePrefix);
        constantsClass = Json.string(root, "constantsClass", constantsClass);
        Object start = root.get("start");
        if (start instanceof Map) {
            Map<String, Object> pose = (Map<String, Object>) start;
            startX = clampField(Json.number(pose, "x", startX));
            startY = clampField(Json.number(pose, "y", startY));
            startHeading = Math.toRadians(Json.number(pose, "headingDegrees", Math.toDegrees(startHeading)));
        }
        Object robotValue = root.get("robot");
        if (robotValue instanceof Map) {
            Map<String, Object> values = (Map<String, Object>) robotValue;
            robot.widthInches = positive(values, "widthInches", robot.widthInches);
            robot.lengthInches = positive(values, "lengthInches", robot.lengthInches);
            robot.trackWidthInches = positive(values, "trackWidthInches", robot.trackWidthInches);
            robot.wheelBaseInches = positive(values, "wheelBaseInches", robot.wheelBaseInches);
            robot.wheelDiameterInches = positive(values, "wheelDiameterInches", robot.wheelDiameterInches);
            robot.motorFreeRpm = positive(values, "motorFreeRpm", robot.motorFreeRpm);
            robot.batteryVolts = positive(values, "batteryVolts", robot.batteryVolts);
        }
        Object deviceList = root.get("devices");
        if (deviceList instanceof List) {
            for (Object item : (List<Object>) deviceList) {
                if (!(item instanceof Map)) continue;
                Map<String, Object> device = (Map<String, Object>) item;
                String name = Json.string(device, "name", null);
                String typeName = Json.string(device, "type", "").trim().toLowerCase(Locale.ROOT);
                if (name == null || name.trim().isEmpty() || !LISTED_TYPE.matcher(typeName).matches()) continue;
                Class<?> type = typeFor(typeName);
                devices.add(new Device(name.trim(), type, type == null ? typeName : null));
            }
        }
    }

    static Class<?> typeFor(String type) {
        switch (type) {
            case "motor": return DcMotorEx.class;
            case "servo": return Servo.class;
            case "crservo": return CRServo.class;
            case "imu": return IMU.class;
            case "digital": return DigitalChannel.class;
            case "touch": return TouchSensor.class;
            case "distance": return DistanceSensor.class;
            default: return null;
        }
    }

    private static double clampField(double value) {
        return Math.max(0, Math.min(144, value));
    }

    private static double positive(Map<String, Object> values, String key, double fallback) {
        double value = Json.number(values, key, fallback);
        return value > 0 && !Double.isInfinite(value) ? value : fallback;
    }
}
