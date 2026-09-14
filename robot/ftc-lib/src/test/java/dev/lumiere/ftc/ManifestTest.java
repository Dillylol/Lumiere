package dev.lumiere.ftc;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.DcMotorController;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.HardwareDevice;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.IMU;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.hardware.VoltageSensor;

import dev.lumiere.ftc.internal.Json;

import org.junit.Test;

import java.lang.reflect.Proxy;
import java.util.Arrays;
import java.util.Collections;
import java.util.Map;

public class ManifestTest {
    @SuppressWarnings("unchecked")
    static <T extends HardwareDevice> T fake(Class<T> type) {
        return (T) Proxy.newProxyInstance(ManifestTest.class.getClassLoader(), new Class<?>[]{type}, (proxy, method, args) -> {
            switch (method.getName()) {
                case "hashCode": return System.identityHashCode(proxy);
                case "equals": return proxy == args[0];
                case "toString": return type.getSimpleName();
                default: return null;
            }
        });
    }

    @Test
    public void listsProgrammableDevicesSortedByNameAndSkipsControllers() {
        HardwareMap map = new HardwareMap(null, null);
        map.put("right_front_drive", fake(DcMotorEx.class));
        map.put("left_front_drive", fake(DcMotorEx.class));
        map.put("claw", fake(Servo.class));
        map.put("intake", fake(CRServo.class));
        map.put("imu", fake(IMU.class));
        map.put("Control Hub", fake(VoltageSensor.class));
        map.put("Expansion Hub 2", fake(DcMotorController.class));

        Map<String, Object> body = Manifest.build(map, Arrays.asList(
                new Manifest.OpModeInfo("Example Auto", "Examples", "autonomous")));

        assertEquals(Json.parse("[{\"name\":\"claw\",\"type\":\"servo\"},"
                        + "{\"name\":\"Control Hub\",\"type\":\"voltage\"},"
                        + "{\"name\":\"imu\",\"type\":\"imu\"},"
                        + "{\"name\":\"intake\",\"type\":\"crservo\"},"
                        + "{\"name\":\"left_front_drive\",\"type\":\"motor\"},"
                        + "{\"name\":\"right_front_drive\",\"type\":\"motor\"}]"),
                Json.parse(Json.write(body.get("devices"))));
        assertEquals(Json.parse("[{\"name\":\"Example Auto\",\"group\":\"Examples\",\"flavor\":\"autonomous\"}]"),
                Json.parse(Json.write(body.get("opModes"))));
    }

    @Test
    public void emptyManifestWithoutHardware() {
        Map<String, Object> body = Manifest.build(null, Collections.<Manifest.OpModeInfo>emptyList());
        assertEquals("{\"devices\":[],\"opModes\":[]}", Json.write(body));
        assertNull(Manifest.typeOf(fake(DcMotorController.class)));
    }
}
