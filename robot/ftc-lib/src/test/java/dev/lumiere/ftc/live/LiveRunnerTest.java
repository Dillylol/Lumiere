package dev.lumiere.ftc.live;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.pedropathing.follower.Follower;
import com.pedropathing.ivy.Command;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;
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
import java.util.HashMap;
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

    /** Stands in for the team's follower: paths finish after a few loops. */
    static final class FakeDrive implements LiveDrive {
        final List<String> calls = new ArrayList<>();
        Pose pose = new Pose(0, 0, 0);
        RuntimeException failure;

        @Override public void setPose(Pose next) { pose = next; calls.add("setPose " + Math.round(next.x()) + "," + Math.round(next.y())); }
        @Override public void update() { if (failure != null) throw failure; }
        @Override public void stop() { calls.add("stop"); }
        @Override public Pose pose() { return pose; }
        @Override public Follower follower() { return null; }

        @Override
        public Command follow(Path path) {
            calls.add("follow");
            int[] loops = {2};
            return Command.build().setDone(() -> --loops[0] <= 0);
        }
    }

    /** What Lumière generates as LumiereLive.java, with this test's pairing secret. */
    public static final class TestLive extends LiveRunner {
        final FakeDrive drive = new FakeDrive();

        @Override protected String pairingHash() { return hex(sha256(SECRET)); }
        @Override protected Class<?> pedroConstants() { return Constants.class; }
        @Override protected Follower createFollower(HardwareMap hardwareMap) { throw new AssertionError("tests use the fake drive"); }
        @Override LiveDrive newDrive() { return drive; }
    }

    /** A connection, recording what the robot sends it, heard from whenever the test says. */
    static final class FakePeer implements StreamServer.Peer {
        final List<Map<String, Object>> sent = new ArrayList<>();
        boolean closed;
        long heard = System.currentTimeMillis();

        @Override public void send(String message) { sent.add(Json.parseObject(message)); }
        @Override public void close() { closed = true; }
        @Override public long lastHeard() { return heard; }
    }

    private final List<Map<String, Object>> published = new ArrayList<>();
    private final List<String> lines = new ArrayList<>();
    /** Every call made on a device, by device name. */
    private final Map<String, List<String>> calls = new HashMap<>();
    /** Encoder positions the fake motors report, by name. */
    private final Map<String, Integer> positions = new HashMap<>();
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
    public void setsUpAnAcceptedProgramAtInitAndRunsItAtStart() {
        FakePeer app = accept(program());
        Map<String, Object> report = last();
        assertEquals(report.toString(), "accepted", report.get("state"));
        assertEquals(Boolean.FALSE, report.get("dryRun"));
        // INIT: the start pose, every mechanism's devices, and the starting state, capped.
        assertTrue(live.drive.calls.toString(), live.drive.calls.contains("setPose 111,136"));
        assertEquals("[setDirection REVERSE, setZeroPowerBehavior BRAKE, setPower 0.0]", calls.get("Intake").toString());
        assertTrue(calls.get("Turret").toString(), calls.get("Turret").contains("setMode STOP_AND_RESET_ENCODER"));
        assertTrue(report.get("notes").toString(), report.get("notes").toString().contains("limits mechanisms to 0.6"));

        live.start();
        assertEquals("running", run().get("phase"));
        for (int i = 0; i < 20 && !"finished".equals(run().get("phase")); i++) {
            app.heard = System.currentTimeMillis();
            live.loop();
        }
        Map<String, Object> run = run();
        assertEquals(run.toString(), "finished", run.get("phase"));
        assertTrue(((Number) run.get("elapsedMs")).doubleValue() >= 0);
        // The intake's full power was capped; the turret went to its target at its own power.
        assertTrue(calls.get("Intake").toString(), calls.get("Intake").contains("setPower 0.6"));
        assertFalse(calls.get("Intake").toString(), calls.get("Intake").contains("setPower 1.0"));
        assertTrue(calls.get("Turret").toString(), calls.get("Turret").containsAll(List.of("setTargetPosition 120", "setMode RUN_TO_POSITION", "setPower 0.5")));
        assertTrue(calls.get("claw").contains("setPosition 0.8"));
        assertEquals(2, live.drive.calls.stream().filter("follow"::equals).count());
        assertTrue(LiveLink.handle(app, program()).contains("already started"));
    }

    @Test
    public void stopsWhenThePairedComputerGoesQuiet() {
        FakePeer app = accept(program());
        live.start();
        app.heard = System.currentTimeMillis() - LiveRunner.SILENCE_MS - 200;
        live.loop();
        assertStopped("silent for more than 1.0 s");
    }

    @Test
    public void stopsWhenThePairedComputerDisconnects() {
        FakePeer app = accept(program());
        live.start();
        LiveLink.disconnected(app);
        live.loop();
        assertStopped("disconnected");
    }

    @Test
    public void stopsWhenAMotorLeavesItsTravel() {
        FakePeer app = accept(program());
        live.start();
        positions.put("Turret", 1000);
        app.heard = System.currentTimeMillis();
        live.loop();
        assertStopped("\"Turret\" in Claw left its travel: it is at 1000 ticks, and its travel is -200 to 400.");
    }

    @Test
    public void stopsAfterAnError() {
        FakePeer app = accept(program());
        live.start();
        live.drive.failure = new IllegalStateException("localizer unplugged");
        app.heard = System.currentTimeMillis();
        live.loop();
        assertStopped("IllegalStateException: localizer unplugged");
    }

    @Test
    public void runsNothingWithoutAPassedProgramOrTheComputer() {
        live.init();
        live.start();
        assertEquals("not run", run().get("phase"));
        assertTrue(String.valueOf(run().get("reason")).contains("No program passed"));
        live.stop();

        setUp();
        FakePeer app = accept(program());
        LiveLink.disconnected(app);
        live.start();
        assertEquals("not run", run().get("phase"));
        assertTrue(String.valueOf(run().get("reason")).contains("not connected"));
    }

    @Test
    public void rejectsMissingMistypedAndPedroOwnedDevicesAndTargetsWithoutTravel() {
        live.init();
        FakePeer app = new FakePeer();
        LiveLink.handle(app, auth(SECRET));
        Map<String, Object> json = program();
        Map<String, Object> program = (Map<String, Object>) json.get("program");
        Map<String, Object> intake = LiveProgramTest.mechanism(program, 0);
        ((Map<String, Object>) ((List<Object>) intake.get("devices")).get(0)).put("name", "lf");
        Map<String, Object> claw = LiveProgramTest.mechanism(program, 1);
        ((Map<String, Object>) ((List<Object>) claw.get("devices")).get(0)).put("name", "Grip1");
        Map<String, Object> turret = (Map<String, Object>) ((List<Object>) claw.get("devices")).get(1);
        turret.put("name", "Turret2");
        turret.remove("travel");
        LiveLink.handle(app, json);
        live.init_loop();
        Map<String, Object> report = last();
        assertEquals("rejected", report.get("state"));
        String problems = report.get("problems").toString();
        assertTrue(problems, problems.contains("\"lf\" in Intake is Pedro Pathing's front left drive motor"));
        assertTrue(problems, problems.contains("\"Grip1\" in Claw is configured as crservo, but the program uses it as a servo"));
        assertTrue(problems, problems.contains("\"Turret2\" in Claw is not in the robot's configuration"));
        assertTrue(problems, problems.contains("\"Turret2\" in Claw takes encoder targets but has no travel range"));
        assertNull(live.acceptedProgram());
        assertTrue(lines.toString(), lines.toString().contains("Check: 4 problems"));
    }

    @Test
    public void runsAFormatTwoProgramWithEachDevicesLimitAndItsTimedSteps() throws InterruptedException {
        FakePeer app = accept(program2());
        Map<String, Object> report = last();
        assertEquals(report.toString(), "accepted", report.get("state"));
        String notes = report.get("notes").toString();
        assertTrue(notes, notes.contains("\"Intake\" is given power 0.9 by an action; its power limit cuts that to 0.7."));
        assertTrue(notes, notes.contains("\"Grip1\" in Roller is given power 1 in \"Spin\"; its power limit cuts that to 0.5."));
        // INIT: the devices the routine sets directly are set up as the generated init() sets them up.
        assertEquals("[setDirection REVERSE, setZeroPowerBehavior BRAKE]", calls.get("Intake").toString());
        assertTrue(calls.get("Turret").toString(), calls.get("Turret").contains("setMode STOP_AND_RESET_ENCODER"));

        live.start();
        runToTheEnd(app);
        assertEquals(run().toString(), "finished", run().get("phase"));
        // Each power is cut to its own device's limit, and each timed step ends in what comes after it.
        assertEquals("[setDirection REVERSE, setZeroPowerBehavior BRAKE, setPower 0.7, setPower 0.4, setPower 0.0]", calls.get("Intake").toString());
        assertTrue(calls.get("Turret").toString(), calls.get("Turret").containsAll(List.of("setTargetPosition 1200", "setMode RUN_TO_POSITION", "setPower 0.8")));
        assertEquals("[setDirection FORWARD, setPosition 0.6, setPosition 0.2]", calls.get("claw").toString());
        // The roller spins at its limit and stops when its time is up. In the race, the wait ends first and
        // cuts the 60-second spin short, and the roller still stops.
        assertEquals("[setDirection FORWARD, setPower 0.0, setPower 0.5, setPower 0.0, setPower 0.5, setPower 0.0]", calls.get("Grip1").toString());
    }

    @Test
    public void stopsWhenADeviceSetDirectlyLeavesItsTravel() {
        FakePeer app = accept(program2());
        live.start();
        positions.put("Turret", 3000);
        app.heard = System.currentTimeMillis();
        live.loop();
        Map<String, Object> run = run();
        assertEquals(run.toString(), "stopped", run.get("phase"));
        assertTrue(run.toString(), String.valueOf(run.get("reason")).contains("\"Turret\" left its travel: it is at 3000 ticks, and its travel is -200 to 1500."));
        assertEquals("setPower 0.0", lastCall("Turret"));
        assertEquals("setPower 0.0", lastCall("Intake"));
        assertEquals("setPower 0.0", lastCall("Grip1"));
    }

    @Test
    public void reportsAStopFromTheDriverStationAsHowTheRunEnded() {
        FakePeer app = accept(program());
        live.start();
        app.heard = System.currentTimeMillis();
        live.loop();
        live.stop();
        assertEquals("closed", last().get("state"));
        assertStopped("STOP was pressed on the Driver Station");
    }

    @Test
    public void keepsAFinishedRunFinishedWhenItStops() {
        FakePeer app = accept(program());
        live.start();
        for (int i = 0; i < 20 && !"finished".equals(run().get("phase")); i++) {
            app.heard = System.currentTimeMillis();
            live.loop();
        }
        live.stop();
        assertEquals("closed", last().get("state"));
        assertEquals("finished", run().get("phase"));
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

    /** Initializes Lumière Live, pairs, and sends a program through to its check. */
    private FakePeer accept(Map<String, Object> message) {
        live.init();
        FakePeer app = new FakePeer();
        assertNull(LiveLink.handle(app, auth(SECRET)));
        assertNull(LiveLink.handle(app, message));
        assertEquals("checking", last().get("state"));
        live.init_loop();
        return app;
    }

    /** Loops, with the paired computer heard from, until the run finishes; timed steps need real time to pass. */
    private void runToTheEnd(FakePeer app) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 3000;
        while (!"finished".equals(run().get("phase")) && !"stopped".equals(run().get("phase")) && System.currentTimeMillis() < deadline) {
            app.heard = System.currentTimeMillis();
            live.loop();
            Thread.sleep(5);
        }
    }

    private void assertStopped(String reason) {
        Map<String, Object> run = run();
        assertEquals(run.toString(), "stopped", run.get("phase"));
        assertTrue(run.toString(), String.valueOf(run.get("reason")).contains(reason));
        // Motors and continuous servos to zero, the follower stopped; servos stay where they are.
        assertEquals("setPower 0.0", lastCall("Intake"));
        assertEquals("setPower 0.0", lastCall("Turret"));
        assertTrue(live.drive.calls.contains("stop"));
    }

    private String lastCall(String device) {
        List<String> list = calls.get(device);
        return list.get(list.size() - 1);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> run() {
        return (Map<String, Object>) last().get("run");
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

    static Map<String, Object> program2() {
        return Json.parseObject("{\"type\":\"program\",\"program\":" + LiveProgramTest.PROGRAM_2 + "}");
    }

    /**
     * The SDK's HardwareMap, without its check for a Control Hub, which loads the hub's native library.
     * The simulator's hardware map does the same.
     */
    static final class DesktopHardwareMap extends HardwareMap {
        DesktopHardwareMap() {
            super(null, null);
        }

        @Override
        public <T> T tryGet(Class<? extends T> type, String name) {
            synchronized (lock) {
                List<HardwareDevice> list = allDevicesMap.get(name.trim());
                if (list != null) for (HardwareDevice device : list) if (type.isInstance(device)) return type.cast(device);
                return null;
            }
        }
    }

    private HardwareMap robot() {
        HardwareMap map = new DesktopHardwareMap();
        for (String name : new String[]{"lf", "rf", "lr", "rr", "Intake", "Turret"}) map.put(name, (HardwareDevice) device(DcMotorEx.class, name));
        map.put("claw", (HardwareDevice) device(Servo.class, "claw"));
        map.put("Grip1", (HardwareDevice) device(CRServo.class, "Grip1"));
        return map;
    }

    /** A device that records every call made on it and reports this test's encoder position. */
    private Object device(Class<?> type, String name) {
        return Proxy.newProxyInstance(LiveRunnerTest.class.getClassLoader(), new Class<?>[]{type}, (proxy, method, args) -> {
            switch (method.getName()) {
                case "hashCode": return System.identityHashCode(proxy);
                case "equals": return proxy == args[0];
                case "toString": return type.getSimpleName();
                case "getCurrentPosition": return positions.getOrDefault(name, 0);
                case "isBusy": return false;
                default:
                    if (method.getName().startsWith("set")) calls.computeIfAbsent(name, key -> new ArrayList<>()).add(method.getName() + " " + args[0]);
                    Class<?> returns = method.getReturnType();
                    if (returns == boolean.class) return false;
                    if (returns == int.class) return 0;
                    if (returns == double.class) return 0.0;
                    return null;
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
