package dev.lumiere.ftc.live;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.pedropathing.follower.Follower;
import com.pedropathing.revhub.drivetrains.MecanumConfig;
import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.HardwareDevice;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;

import dev.lumiere.ftc.Stream;
import dev.lumiere.ftc.internal.Json;
import dev.lumiere.ftc.internal.StreamServer;

import org.firstinspires.ftc.robotcore.external.Telemetry;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class LiveRunnerTest {
    static final String SECRET = "6f1d2c3b4a5968778695a4b3c2d1e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091";

    /** Drive motors lf/rf/lr/rr, as Pedro's constants name them. */
    public static final class Constants {
        public static MecanumConfig drivetrainConfig = drive();

        static MecanumConfig drive() {
            MecanumConfig c = new MecanumConfig();
            c.frontLeftName.set("lf");
            c.frontRightName.set("rf");
            c.backLeftName.set("lr");
            c.backRightName.set("rr");
            return c;
        }
    }

    /** What Lumière generates as LumiereLive.java, with this test's pairing secret. */
    public static final class TestLive extends LiveRunner {
        @Override protected String pairingHash() { return hex(sha256(SECRET)); }
        @Override protected Class<?> pedroConstants() { return Constants.class; }
        @Override protected Follower createFollower(HardwareMap hardwareMap) { throw new AssertionError("The dry run must not build a follower"); }
    }

    /** A connection, recording what the robot sends it. */
    static final class FakePeer implements StreamServer.Peer {
        final List<Map<String, Object>> sent = new ArrayList<>();
        boolean closed;

        @Override public void send(String message) { sent.add(Json.parseObject(message)); }
        @Override public void close() { closed = true; }
    }

    private final List<Map<String, Object>> published = new ArrayList<>();
    private final List<String> lines = new ArrayList<>();
    private final Stream.Transport transport = new Stream.Transport() {
        @Override public boolean hasClients() { return true; }
        @Override public void broadcast(String message) { published.add(Json.parseObject(message)); }
    };
    private TestLive live;

    @Before
    public void setUp() {
        Stream.install(transport);
        live = new TestLive();
        live.hardwareMap = robot();
        live.telemetry = telemetry(lines);
    }

    @After
    public void tearDown() {
        live.stop();
        Stream.uninstall(transport);
    }

    @Test
    public void refusesEverythingUntilLumiereLiveIsInitialized() {
        FakePeer app = new FakePeer();
        String reply = LiveLink.handle(app, auth(SECRET));
        assertTrue(reply, reply.contains("Lumière Live is not running"));
    }

    @Test
    public void pairsOnlyWithTheRightSecretAndClosesAfterRepeatedFailures() {
        live.init();
        FakePeer app = new FakePeer();
        assertTrue(LiveLink.handle(app, program()).contains("Pair with Lumière Live"));
        for (int i = 1; i < LiveRunner.MAX_PAIRING_FAILURES; i++) {
            assertTrue(LiveLink.handle(app, auth("wrong secret")).contains("not paired"));
            assertFalse(app.closed);
        }
        assertNull(LiveLink.handle(app, auth("wrong secret")));
        assertTrue(app.closed);
        assertTrue(String.valueOf(app.sent.get(0).get("message")).contains("not paired"));

        FakePeer paired = new FakePeer();
        assertNull(LiveLink.handle(paired, auth(SECRET)));
        assertEquals(Boolean.TRUE, last().get("paired"));
        LiveLink.disconnected(paired);
        assertEquals(Boolean.FALSE, last().get("paired"));
    }

    @Test
    public void checksAProgramAgainstTheHardwareAndMovesNothing() {
        live.init();
        FakePeer app = new FakePeer();
        LiveLink.handle(app, auth(SECRET));
        assertNull(LiveLink.handle(app, program()));
        assertEquals("checking", last().get("state"));
        live.init_loop();
        Map<String, Object> report = last();
        assertEquals(report.toString(), "accepted", report.get("state"));
        assertEquals(Boolean.TRUE, report.get("dryRun"));
        Map<?, ?> summary = (Map<?, ?>) report.get("program");
        assertEquals("Red Goal", summary.get("name"));
        assertEquals(3.0, summary.get("steps"));
        // Intake runs at full power; Lumière Live will cap it.
        assertTrue(report.get("notes").toString(), report.get("notes").toString().contains("limits mechanisms to 0.6"));
        assertTrue(lines.toString(), lines.toString().contains("Program: Red Goal (3f2a9c1b)"));
        assertNotNull(live.acceptedProgram());

        live.start();
        live.loop();
        assertEquals(Boolean.TRUE, last().get("started"));
        assertTrue(LiveLink.handle(app, program()).contains("already started"));
    }

    @Test
    public void rejectsMissingMistypedAndPedroOwnedDevices() {
        live.init();
        FakePeer app = new FakePeer();
        LiveLink.handle(app, auth(SECRET));
        Map<String, Object> json = program();
        Map<String, Object> program = (Map<String, Object>) json.get("program");
        Map<String, Object> intake = LiveProgramTest.mechanism(program, 0);
        ((Map<String, Object>) ((List<Object>) intake.get("devices")).get(0)).put("name", "lf");
        Map<String, Object> claw = LiveProgramTest.mechanism(program, 1);
        ((Map<String, Object>) ((List<Object>) claw.get("devices")).get(0)).put("name", "Grip1");
        ((Map<String, Object>) ((List<Object>) claw.get("devices")).get(1)).put("name", "Turret2");
        LiveLink.handle(app, json);
        live.init_loop();
        Map<String, Object> report = last();
        assertEquals("rejected", report.get("state"));
        String problems = report.get("problems").toString();
        assertTrue(problems, problems.contains("\"lf\" in Intake is Pedro Pathing's front left drive motor"));
        assertTrue(problems, problems.contains("\"Grip1\" in Claw is configured as crservo, but the program uses it as a servo"));
        assertTrue(problems, problems.contains("\"Turret2\" in Claw is not in the robot's configuration"));
        assertNull(live.acceptedProgram());
        assertTrue(lines.toString(), lines.toString().contains("Check: 3 problems"));
    }

    @Test
    public void forgetsTheReportWhenItStops() {
        live.init();
        assertNotNull(Stream.lastLive());
        live.stop();
        assertEquals("closed", last().get("state"));
        assertNull(Stream.lastLive());
        assertTrue(LiveLink.handle(new FakePeer(), auth(SECRET)).contains("not running"));
    }

    private Map<String, Object> last() {
        for (int i = published.size() - 1; i >= 0; i--) if ("live".equals(published.get(i).get("type"))) return published.get(i);
        throw new AssertionError("no live message");
    }

    static Map<String, Object> auth(String token) {
        return Json.parseObject("{\"type\":\"auth\",\"token\":" + Json.write(token) + "}");
    }

    static Map<String, Object> program() {
        return Json.parseObject("{\"type\":\"program\",\"program\":" + LiveProgramTest.PROGRAM + "}");
    }

    static HardwareMap robot() {
        HardwareMap map = new HardwareMap(null, null);
        for (String name : new String[]{"lf", "rf", "lr", "rr", "Intake", "Turret"}) map.put(name, (HardwareDevice) fake(DcMotorEx.class));
        map.put("claw", (HardwareDevice) fake(Servo.class));
        map.put("Grip1", (HardwareDevice) fake(CRServo.class));
        return map;
    }

    static Object fake(Class<?> type) {
        return Proxy.newProxyInstance(LiveRunnerTest.class.getClassLoader(), new Class<?>[]{type}, (proxy, method, args) -> {
            switch (method.getName()) {
                case "hashCode": return System.identityHashCode(proxy);
                case "equals": return proxy == args[0];
                case "toString": return type.getSimpleName();
                default: return null;
            }
        });
    }

    /** Telemetry that records each line as "caption: value" or the line itself. */
    static Telemetry telemetry(List<String> lines) {
        return (Telemetry) Proxy.newProxyInstance(LiveRunnerTest.class.getClassLoader(), new Class<?>[]{Telemetry.class}, (proxy, method, args) -> {
            if (method.getName().equals("addLine") && args != null && args.length == 1) lines.add(String.valueOf(args[0]));
            if (method.getName().equals("addData") && args != null && args.length == 2) lines.add(args[0] + ": " + args[1]);
            if (method.getName().equals("hashCode")) return System.identityHashCode(proxy);
            if (method.getName().equals("equals")) return proxy == args[0];
            Class<?> returns = method.getReturnType();
            if (returns == boolean.class) return false;
            if (returns == int.class) return 0;
            return null;
        });
    }

    static byte[] sha256(String text) {
        return LiveRunner.sha256(text);
    }

    static String hex(byte[] bytes) {
        StringBuilder text = new StringBuilder();
        for (byte b : bytes) text.append(String.format("%02x", b));
        return text.toString();
    }
}
