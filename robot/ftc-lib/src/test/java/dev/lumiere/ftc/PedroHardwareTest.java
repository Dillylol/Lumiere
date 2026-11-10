package dev.lumiere.ftc;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;

import com.pedropathing.revhub.drivetrains.CoaxialPodConfig;
import com.pedropathing.revhub.drivetrains.MecanumConfig;
import com.pedropathing.revhub.localizers.PinpointConfig;
import com.pedropathing.revhub.localizers.ThreeWheelIMUConfig;

import dev.lumiere.ftc.internal.Json;

import org.junit.After;
import org.junit.Test;

import java.util.Collections;
import java.util.Map;

public class PedroHardwareTest {
    /** Bjorn's layout: dead wheels on three drive motors' encoder ports, and the hub's IMU. */
    static final class ThreeWheelConstants {
        public static final boolean TUNED = false;
        public static MecanumConfig drivetrainConfig = drive("lf", "rf", "lr", "rr");
        public static ThreeWheelIMUConfig localizerConfig = threeWheel();

        private static ThreeWheelIMUConfig threeWheel() {
            ThreeWheelIMUConfig c = new ThreeWheelIMUConfig();
            c.leftEncoderName.set("lf");
            c.rightEncoderName.set(" lr ");
            c.strafeEncoderName.set("rf");
            // imuName is left unset: Pedro throws for it, and it is left out.
            c.leftPodY.set(2.5);
            return c;
        }
    }

    static final class PinpointConstants {
        private static final MecanumConfig DRIVE = drive("left_front_drive", "right_front_drive", "left_back_drive", "right_back_drive");
        private static final PinpointConfig LOCALIZER = pinpoint();
        private static final CoaxialPodConfig POD = pod();

        private static PinpointConfig pinpoint() {
            PinpointConfig c = new PinpointConfig();
            c.name.set("pinpoint");
            return c;
        }

        private static CoaxialPodConfig pod() {
            CoaxialPodConfig c = new CoaxialPodConfig();
            c.name.set("front left pod");
            c.motorName.set("swerve_motor");
            return c;
        }
    }

    static boolean notPedroInitialized;

    /** A class without Pedro configs. Its initializer must not run. */
    static final class NotPedro {
        static {
            notPedroInitialized = true;
        }

        public static String name = "lf";
    }

    static MecanumConfig drive(String frontLeft, String frontRight, String backLeft, String backRight) {
        MecanumConfig c = new MecanumConfig();
        c.frontLeftName.set(frontLeft);
        c.frontRightName.set(frontRight);
        c.backLeftName.set(backLeft);
        c.backRightName.set(backRight);
        return c;
    }

    @After
    public void restoreDefaults() {
        PedroHardware.useConstants(null);
    }

    @Test
    public void namesEachDeviceByPedrosOwnSetting() {
        assertEquals(Json.parse("{\"constants\":\"" + ThreeWheelConstants.class.getName() + "\",\"localizer\":\"threewheelimu\",\"devices\":["
                        + "{\"name\":\"lf\",\"role\":\"frontLeft\"},{\"name\":\"lr\",\"role\":\"backLeft\"},"
                        + "{\"name\":\"rf\",\"role\":\"frontRight\"},{\"name\":\"rr\",\"role\":\"backRight\"},"
                        + "{\"name\":\"lf\",\"role\":\"leftEncoder\"},{\"name\":\"lr\",\"role\":\"rightEncoder\"},"
                        + "{\"name\":\"rf\",\"role\":\"strafeEncoder\"}]}"),
                Json.parse(Json.write(PedroHardware.describe(ThreeWheelConstants.class))));
    }

    @Test
    public void aSingleDeviceLocalizerUsesItsKindAndSwervePodLabelsAreNotDevices() {
        Map<String, Object> pedro = PedroHardware.describe(PinpointConstants.class);
        assertEquals("pinpoint", pedro.get("localizer"));
        assertEquals(Json.parse("[{\"name\":\"left_front_drive\",\"role\":\"frontLeft\"},{\"name\":\"left_back_drive\",\"role\":\"backLeft\"},"
                        + "{\"name\":\"right_front_drive\",\"role\":\"frontRight\"},{\"name\":\"right_back_drive\",\"role\":\"backRight\"},"
                        + "{\"name\":\"pinpoint\",\"role\":\"pinpoint\"},{\"name\":\"swerve_motor\",\"role\":\"motor\"}]"),
                Json.parse(Json.write(pedro.get("devices"))));
    }

    @Test
    public void classesWithoutPedroConfigsAreNotInitialized() throws Exception {
        Class<?> notPedro = Class.forName(NotPedro.class.getName(), false, getClass().getClassLoader());
        assertNull(PedroHardware.describe(notPedro));
        assertFalse(notPedroInitialized);
    }

    @Test
    public void theManifestReportsTheNamedConstantsClass() {
        assertNull(Manifest.build(null, Collections.emptyList()).get("pedro"));
        PedroHardware.useConstants(PinpointConstants.class.getName());
        @SuppressWarnings("unchecked")
        Map<String, Object> pedro = (Map<String, Object>) Manifest.build(null, Collections.emptyList()).get("pedro");
        assertEquals(PinpointConstants.class.getName(), pedro.get("constants"));
        PedroHardware.useConstants("org.example.Missing");
        assertNull(Manifest.build(null, Collections.emptyList()).get("pedro"));
    }
}
