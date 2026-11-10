package dev.lumiere.sim;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.qualcomm.robotcore.hardware.AnalogInput;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DcMotorSimple;

import dev.lumiere.ftc.Manifest;
import dev.lumiere.ftc.PedroHardware;
import dev.lumiere.ftc.internal.Json;
import dev.lumiere.sim.hardware.SimHardwareMap;
import dev.lumiere.sim.testbed.DeadWheelConstants;
import dev.lumiere.sim.testbed.TestConstants;
import dev.lumiere.sim.testbed.TestOpModes;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

public class DiscoveryAndCatalogTest {
    @Test
    public void readsDrivetrainNamesAndDirectionsFromPedroConstants() {
        DrivetrainDiscovery.Drivetrain drivetrain = DrivetrainDiscovery.discover(TestConstants.class.getName());
        assertEquals("fl", drivetrain.frontLeft);
        assertEquals("fr", drivetrain.frontRight);
        assertEquals("bl", drivetrain.backLeft);
        assertEquals("br", drivetrain.backRight);
        assertEquals(DcMotorSimple.Direction.REVERSE, drivetrain.frontLeftDirection);
        assertEquals(DcMotorSimple.Direction.FORWARD, drivetrain.backRightDirection);
        assertEquals("odometry", drivetrain.pinpoint);
        assertEquals(TestConstants.class.getName(), drivetrain.source);
    }

    @Test
    public void readsTheKinematicsPedroPathingMeasured() {
        DrivetrainDiscovery.Drivetrain drivetrain = DrivetrainDiscovery.discover(DeadWheelConstants.class.getName());
        assertEquals("lf", drivetrain.frontLeft);
        assertEquals("rr", drivetrain.backRight);
        // The robot has no Pinpoint; its pose comes from Pedro Pathing all the same.
        assertNull(drivetrain.pinpoint);
        assertEquals(45, drivetrain.forwardVelocity, 1e-9);
        assertEquals(30, drivetrain.strafeVelocity, 1e-9);
        assertEquals(35, drivetrain.forwardDeceleration, 1e-9);
        assertEquals(70, drivetrain.strafeDeceleration, 1e-9);
        assertTrue(Double.isNaN(DrivetrainDiscovery.discover("org.example.Missing").forwardVelocity));
    }

    @Test
    public void reportsTheDevicesPedroDrivesWithPedrosOwnRoles() {
        Map<String, Object> pedro = PedroHardware.describe(DeadWheelConstants.class);
        assertEquals("threewheelimu", pedro.get("localizer"));
        String devices = Json.write(pedro.get("devices"));
        for (String expected : new String[]{
                "{\"name\":\"lf\",\"role\":\"frontLeft\"}", "{\"name\":\"rr\",\"role\":\"backRight\"}",
                "{\"name\":\"lf\",\"role\":\"leftEncoder\"}", "{\"name\":\"lr\",\"role\":\"rightEncoder\"}",
                "{\"name\":\"rf\",\"role\":\"strafeEncoder\"}", "{\"name\":\"imu\",\"role\":\"imu\"}"}) {
            assertTrue(devices, devices.contains(expected));
        }
    }

    @Test
    public void listsConfiguredDevicesItCannotSimulate() {
        SimulatorConfig config = new SimulatorConfig();
        config.apply(Json.parseObject("{\"devices\":[{\"name\":\"ranger\",\"type\":\"analog\"},{\"name\":\" Webcam 1 \",\"type\":\"Camera\"},"
                + "{\"name\":\"odd\",\"type\":\"two words\"},{\"name\":\"arm\",\"type\":\"motor\"}]}"));
        assertEquals(3, config.devices.size());
        assertNull(config.devices.get(0).type);
        assertEquals("analog", config.devices.get(0).listedType);
        assertEquals("Webcam 1", config.devices.get(1).name);
        assertEquals("camera", config.devices.get(1).listedType);
        assertEquals(DcMotorEx.class, config.devices.get(2).type);
        assertNull(config.devices.get(2).listedType);

        try (Simulation simulation = new Simulation(config.robot, DrivetrainDiscovery.discover(TestConstants.class.getName()), 72, 72, 0, null)) {
            for (SimulatorConfig.Device device : config.devices) device.declareIn(simulation.hardware());
            SimHardwareMap map = new SimHardwareMap(simulation.hardware());
            map.registerDeclared();
            String devices = Json.write(Manifest.build(map, Collections.<Manifest.OpModeInfo>emptyList()).get("devices"));
            assertTrue(devices, devices.contains("{\"name\":\"ranger\",\"type\":\"analog\"}"));
            assertTrue(devices, devices.contains("{\"name\":\"Webcam 1\",\"type\":\"camera\"}"));
            assertTrue(devices, devices.contains("{\"name\":\"arm\",\"type\":\"motor\"}"));
            // Listed only: OpModes asking for them get nothing, as before.
            assertNull(map.tryGet(AnalogInput.class, "ranger"));
            assertNotNull(map.tryGet(DcMotorEx.class, "arm"));
        }
    }

    @Test
    public void fallsBackToFtcSampleNames() {
        DrivetrainDiscovery.Drivetrain drivetrain = DrivetrainDiscovery.discover("org.example.Missing");
        assertEquals("left_front_drive", drivetrain.frontLeft);
        assertEquals("pinpoint", drivetrain.pinpoint);
        assertEquals("FTC SDK sample names", drivetrain.source);
    }

    @Test
    public void catalogListsEnabledOpModesByFlavorGroupAndName() {
        List<OpModeCatalog.Entry> entries = OpModeCatalog.scan("dev.lumiere.sim.testbed");
        List<String> names = new ArrayList<>();
        for (OpModeCatalog.Entry entry : entries) names.add(entry.flavor + "/" + entry.name);
        assertEquals(java.util.Arrays.asList(
                "autonomous/Test Arm", "autonomous/Test Crash", "autonomous/Test Dead Wheel Auto", "autonomous/Test Path Auto",
                "autonomous/Test Stuck", "teleop/Test Dead Wheel Drive", "teleop/Test Drive"), names);
        OpModeCatalog.Entry drive = OpModeCatalog.find(entries, "Test Drive");
        assertNotNull(drive);
        assertEquals(TestOpModes.Drive.class, drive.type);
        assertEquals("Tests", drive.group);
        assertNull(OpModeCatalog.entryFor(TestOpModes.Hidden.class));
        assertNull(OpModeCatalog.entryFor(String.class));
        assertTrue(OpModeCatalog.scan("org.example.none").isEmpty());
    }
}
