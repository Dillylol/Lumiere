package dev.lumiere.ftc.internal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.HardwareDevice;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;

import dev.lumiere.ftc.Session;
import dev.lumiere.ftc.Stream;

import org.firstinspires.ftc.teamcode.lumieretest.TeamCode;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class OpModeWatchTest {
    private final List<Map<String, Object>> published = new ArrayList<>();
    private final Stream.Transport transport = new Stream.Transport() {
        @Override public boolean hasClients() { return true; }
        @Override public void broadcast(String message) { published.add(Json.parseObject(message)); }
    };

    @Before
    public void setUp() {
        Stream.install(transport);
    }

    @After
    public void tearDown() {
        Stream.uninstall(transport);
    }

    @Test
    public void findsFollowersInTheTeamsObjectsAndStaticFieldsButNotInLibraryObjects() {
        TeamCode.TeamAuto auto = new TeamCode.TeamAuto();
        List<Object> found = FollowerSearch.find(auto);
        assertEquals(1, found.size());
        assertEquals(auto.robot.follower, found.get(0));
        double[] pose = FollowerSearch.pose(found.get(0));
        assertEquals(10, pose[0], 0);
        assertEquals(1.5, pose[2], 0);

        assertEquals(List.of(TeamCode.StaticHolder.SHARED), FollowerSearch.find(new TeamCode.Holder()));
        assertNull(FollowerSearch.pose(new Object()));
    }

    @Test
    public void reportsTheFollowersPoseAndTheDevicesOutputsOfAnyOpMode() throws Exception {
        TeamCode.TeamAuto auto = new TeamCode.TeamAuto();
        auto.hardwareMap = hardware(0.4, 0.3);
        // Wait out any session another test just reported through.
        while (Session.publishedWithin(OpModeWatch.SESSION_QUIET_MS)) Thread.sleep(20);
        new OpModeWatch(auto, "Team Auto").report();

        Map<String, Object> state = last("state");
        assertEquals("Team Auto", state.get("opMode"));
        Map<?, ?> pose = (Map<?, ?>) state.get("pose");
        assertEquals(10.0, ((Number) pose.get("x")).doubleValue(), 0);
        assertEquals(20.0, ((Number) pose.get("y")).doubleValue(), 0);
        assertEquals(1.5, ((Number) pose.get("heading")).doubleValue(), 0);

        Map<?, ?> devices = (Map<?, ?>) last("devices").get("devices");
        assertEquals("{type=motor, power=0.4}", devices.get("intake").toString());
        assertEquals("{type=servo, position=0.3}", devices.get("claw").toString());
    }

    @Test
    public void leavesThePoseToASessionAndStillReportsDevices() {
        TeamCode.TeamAuto auto = new TeamCode.TeamAuto();
        auto.hardwareMap = hardware(0.2, 0.5);
        Session.attach(auto).update();
        published.clear();
        new OpModeWatch(auto, "Team Auto").report();
        assertTrue(published.toString(), published.stream().noneMatch(message -> "state".equals(message.get("type"))));
        assertEquals("{type=motor, power=0.2}", ((Map<?, ?>) last("devices").get("devices")).get("intake").toString());
    }

    private Map<String, Object> last(String type) {
        for (int i = published.size() - 1; i >= 0; i--) if (type.equals(published.get(i).get("type"))) return published.get(i);
        throw new AssertionError("no " + type + " message in " + published);
    }

    /** A hardware map with an "intake" motor and a "claw" servo that report these outputs. */
    private static HardwareMap hardware(double power, double position) {
        HardwareMap map = new HardwareMap(null, null) {
            @Override
            public <T> T tryGet(Class<? extends T> type, String name) {
                return null;
            }
        };
        map.put("intake", (HardwareDevice) device(DcMotorEx.class, "getPower", power));
        map.put("claw", (HardwareDevice) device(Servo.class, "getPosition", position));
        return map;
    }

    private static Object device(Class<?> type, String getter, double value) {
        return Proxy.newProxyInstance(OpModeWatchTest.class.getClassLoader(), new Class<?>[]{type}, (proxy, method, args) -> {
            if (getter.equals(method.getName())) return value;
            return TeamCode.zero(method.getReturnType(), proxy, method.getName(), args);
        });
    }
}
