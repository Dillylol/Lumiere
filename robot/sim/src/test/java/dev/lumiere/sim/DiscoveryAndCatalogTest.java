package dev.lumiere.sim;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.qualcomm.robotcore.hardware.DcMotorSimple;

import dev.lumiere.sim.testbed.TestConstants;
import dev.lumiere.sim.testbed.TestOpModes;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

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
                "autonomous/Test Arm", "autonomous/Test Crash", "autonomous/Test Path Auto", "autonomous/Test Stuck",
                "teleop/Test Drive"), names);
        OpModeCatalog.Entry drive = OpModeCatalog.find(entries, "Test Drive");
        assertNotNull(drive);
        assertEquals(TestOpModes.Drive.class, drive.type);
        assertEquals("Tests", drive.group);
        assertNull(OpModeCatalog.entryFor(TestOpModes.Hidden.class));
        assertNull(OpModeCatalog.entryFor(String.class));
        assertTrue(OpModeCatalog.scan("org.example.none").isEmpty());
    }
}
