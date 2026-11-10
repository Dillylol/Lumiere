package dev.lumiere.ftc.live;

import com.pedropathing.api.PoseFactory;
import com.pedropathing.follower.Follower;
import com.pedropathing.ivy.Scheduler;
import com.pedropathing.math.Pose;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.hardware.HardwareMap;

import dev.lumiere.ftc.PedroHardware;
import dev.lumiere.ftc.Session;
import dev.lumiere.ftc.Stream;
import dev.lumiere.ftc.internal.Json;
import dev.lumiere.ftc.internal.StreamServer;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Lumière Live runs autonomous programs that a paired computer sends, so a team can try a program
 * without rebuilding and installing the robot code.
 *
 * <p>When the Driver Station initializes Lumière Live, the paired computer sends a program. Lumière
 * Live checks it against this robot's configured hardware and the devices Pedro Pathing drives, and
 * reports what it found to the app and on the Driver Station. A program that passes is set up as a
 * generated OpMode's init() would set it up: the start pose, and each mechanism's starting state.
 * START runs it with the same Pedro Pathing paths and Ivy commands the generated Java would use.
 *
 * <p>Safety:
 * <ul>
 *   <li>Mechanism powers are capped at {@link #powerCap()}, and motors that take encoder targets
 *       must stay within their declared travel.</li>
 *   <li>The run stops when the paired computer goes quiet for more than {@link #SILENCE_MS}
 *       milliseconds or disconnects, when a motor leaves its travel, or on any error. Stopping sets
 *       motors and continuous servos to zero, leaves servos where they are, stops the follower, and
 *       ends the OpMode.</li>
 *   <li>The program can't change after START, and only the program's own mechanism devices are
 *       driven, never Pedro Pathing's.</li>
 *   <li>The Driver Station stays in charge: only it can INIT and START Lumière Live, and its STOP
 *       always works.</li>
 * </ul>
 *
 * <p>Teams don't write a subclass. Lumière generates {@code LumiereLive.java} when Live runs are
 * turned on for a computer, carrying that computer's pairing hash.
 */
public abstract class LiveRunner extends OpMode {
    /** The name Lumière gives the generated OpMode on the Driver Station. */
    public static final String NAME = "Lumière Live";
    public static final double DEFAULT_POWER_CAP = 0.6;
    /** The paired computer must be heard from at least this often while a program runs. */
    public static final long SILENCE_MS = 1000;
    /** Wrong pairing attempts a connection may make before it is closed. */
    static final int MAX_PAIRING_FAILURES = 5;
    private static final int TELEMETRY_PROBLEMS = 6;
    private static final PoseFactory POSES = PoseFactory.degrees();

    /** SHA-256 of the paired computer's secret, as 64 hexadecimal digits. */
    protected abstract String pairingHash();

    /** The team's Pedro Pathing constants class, which names the devices Pedro drives. May be null. */
    protected abstract Class<?> pedroConstants();

    /** Builds the team's follower, as the generated OpModes do with {@code Constants.create}. */
    protected abstract Follower createFollower(HardwareMap hardwareMap);

    /** The highest power Lumière Live gives a mechanism motor or continuous servo, above 0 and at most 1. */
    protected double powerCap() {
        return DEFAULT_POWER_CAP;
    }

    /** How Lumière Live drives Pedro Pathing. The library's tests replace the team's follower here. */
    LiveDrive newDrive() {
        Follower follower = createFollower(hardwareMap);
        return follower == null ? null : new LiveDrive.Pedro(follower);
    }

    // Shared with the stream's threads; guarded by this.
    private StreamServer.Peer peer;
    private final Map<StreamServer.Peer, Integer> failures = new HashMap<>();
    private Object pendingProgram;
    private boolean started;
    private boolean closed;
    private String state = "waiting";
    private Map<String, Object> summary;
    private List<String> problems = Collections.emptyList();
    private List<String> notes = Collections.emptyList();
    private LiveProgram program;
    /** The run after START: null before, then running, finished, stopped or "not run", with a reason. */
    private String runPhase;
    private String runReason;
    private double runElapsedMs = -1;

    // The OpMode's own thread only.
    private byte[] expectedHash;
    private String pairingProblem;
    private double cap = DEFAULT_POWER_CAP;
    private LiveDrive drive;
    private String driveProblem;
    private Session session;
    private final Map<String, LiveMechanism> mechanisms = new LinkedHashMap<>();
    private final Set<String> resetMotors = new HashSet<>();
    private long routineStartedNanos;

    @Override
    public final void init() {
        expectedHash = hexBytes(pairingHash());
        pairingProblem = expectedHash == null || expectedHash.length != 32
                ? "This Lumière Live has no valid pairing. Turn on Live runs in Lumière, deploy, and install the robot code again." : null;
        double requested = powerCap();
        cap = requested > 0 && requested <= 1 ? requested : DEFAULT_POWER_CAP;
        try {
            Class<?> constants = pedroConstants();
            // The manifest names Pedro's devices from the class the team's code really uses.
            if (constants != null) PedroHardware.useConstants(constants.getName());
        } catch (RuntimeException | LinkageError ignored) {
            // The check reports that Pedro's devices are unknown.
        }
        // As a generated OpMode's init(): a clean scheduler, then the team's follower.
        Scheduler.reset();
        try {
            drive = newDrive();
            if (drive == null) driveProblem = "Lumière Live could not build the team's follower: createFollower returned nothing.";
            else drive.update();
        } catch (RuntimeException e) {
            drive = null;
            driveProblem = "Lumière Live could not build the team's follower: " + describe(e);
        }
        session = Session.attach(this);
        if (drive != null && drive.follower() != null) session.follower(drive.follower());
        LiveLink.open(this);
        publish();
        show();
    }

    @Override
    public final void init_loop() {
        Object received;
        synchronized (this) {
            received = pendingProgram;
            pendingProgram = null;
        }
        if (received != null) check(received);
        if (drive != null) drive.update();
        report();
        show();
    }

    @Override
    public final void start() {
        LiveProgram ready;
        boolean connected;
        synchronized (this) {
            started = true;
            ready = "accepted".equals(state) ? program : null;
            connected = peer != null && System.currentTimeMillis() - peer.lastHeard() <= SILENCE_MS;
        }
        if (ready == null) {
            setRun("not run", "No program passed the check, so nothing runs. Stop, fix the program, and INIT " + NAME + " again.");
        } else if (!connected) {
            setRun("not run", "The paired computer is not connected, so nothing runs.");
        } else {
            routineStartedNanos = System.nanoTime();
            try {
                Scheduler.schedule(LiveRoutine.build(ready, drive, mechanisms, this::complete));
                setRun("running", null);
            } catch (RuntimeException e) {
                abort("Lumière Live could not start the routine: " + describe(e));
                return;
            }
        }
        show();
    }

    @Override
    public final void loop() {
        String phase;
        synchronized (this) {
            phase = runPhase;
        }
        if ("running".equals(phase) || "finished".equals(phase)) {
            // A finished routine keeps the follower holding its last pose, as a generated OpMode does,
            // so the paired computer must still be there.
            try {
                String danger = danger();
                if (danger != null) {
                    abort(danger);
                    return;
                }
                drive.update();
                Scheduler.execute();
            } catch (RuntimeException e) {
                abort("Lumière Live stopped after an error: " + describe(e));
                return;
            }
        }
        report();
        show();
    }

    @Override
    public final void stop() {
        halt();
        if (session != null) session.close();
        LiveLink.close(this);
        synchronized (this) {
            // The app keeps showing how a run ended after the OpMode closes, so a STOP mid-run says so.
            if ("running".equals(runPhase)) {
                runPhase = "stopped";
                runReason = NAME + " stopped: STOP was pressed on the Driver Station.";
            }
            closed = true;
            state = "closed";
            peer = null;
            failures.clear();
        }
        publish();
        Stream.clearLive();
    }

    /** The program accepted at INIT, for the run that follows. Null until one passes the check. */
    protected final synchronized LiveProgram acceptedProgram() {
        return "accepted".equals(state) ? program : null;
    }

    /** Checks a program on the OpMode's thread, where reading the hardware map is safe, and sets it up if it passes. */
    private void check(Object json) {
        LiveProgram.Reading reading = LiveProgram.read(json);
        List<String> found = new ArrayList<>(reading.problems);
        List<String> notesFound = new ArrayList<>();
        if (driveProblem != null) found.add(driveProblem);
        if (reading.program != null) {
            Map<String, Object> pedro = pedro();
            HardwareCheck.Result hardware = HardwareCheck.check(reading.program, hardwareMap, pedro, cap);
            found.addAll(hardware.problems);
            notesFound.addAll(hardware.notes);
            if (pedro == null) notesFound.add("Lumière Live could not read the team's Pedro Pathing constants, so it cannot tell which devices Pedro drives.");
        }
        if (found.isEmpty()) {
            String setup = prepare(reading.program);
            if (setup != null) found.add(setup);
        }
        synchronized (this) {
            summary = summaryOf(json);
            problems = Collections.unmodifiableList(found);
            notes = Collections.unmodifiableList(notesFound);
            program = found.isEmpty() ? reading.program : null;
            state = found.isEmpty() ? "accepted" : "rejected";
        }
        publish();
    }

    /**
     * Sets up an accepted program as a generated OpMode's init() does: the follower at the start pose,
     * then each mechanism's devices and starting state. Its paths are built once here so Pedro
     * Pathing's own objections show before START.
     *
     * @return why the program could not be set up, or null
     */
    private String prepare(LiveProgram accepted) {
        try {
            for (LiveProgram.Path path : accepted.paths) LivePaths.build(path);
            drive.setPose(POSES.of(accepted.start.x, accepted.start.y, accepted.start.headingDeg));
            drive.update();
            mechanisms.clear();
            for (LiveProgram.Mechanism mechanism : accepted.mechanisms) {
                LiveMechanism live = new LiveMechanism(mechanism, hardwareMap, cap, resetMotors);
                live.initialize();
                mechanisms.put(mechanism.id, live);
            }
            return null;
        } catch (RuntimeException e) {
            mechanisms.clear();
            return "Lumière Live could not set the program up: " + describe(e);
        }
    }

    /** Why the run must stop now, or null while it may go on. */
    private String danger() {
        StreamServer.Peer current;
        synchronized (this) {
            current = peer;
        }
        if (current == null) return "Lumière Live stopped: the paired computer disconnected.";
        if (System.currentTimeMillis() - current.lastHeard() > SILENCE_MS) {
            return "Lumière Live stopped: the paired computer was silent for more than " + (SILENCE_MS / 1000.0) + " s.";
        }
        for (LiveMechanism mechanism : mechanisms.values()) {
            String travel = mechanism.travelProblem();
            if (travel != null) return "Lumière Live stopped: " + travel;
        }
        return null;
    }

    /** Called by the routine's last step, as a generated OpMode reports completion. */
    private void complete() {
        double elapsedMs = (System.nanoTime() - routineStartedNanos) / 1_000_000.0;
        synchronized (this) {
            runElapsedMs = elapsedMs;
        }
        if (session != null) session.data("lumiere.routineElapsedMs", elapsedMs);
        setRun("finished", null);
    }

    /** Stops everything this run moves, then ends the OpMode. */
    private void abort(String reason) {
        halt();
        setRun("stopped", reason);
        show();
        try {
            requestOpModeStop();
        } catch (RuntimeException ignored) {
            // Without the Robot Controller (in the library's tests) there is nothing to ask.
        }
    }

    /** Motors and continuous servos to zero, servos where they are, the follower stopped. */
    private void halt() {
        Scheduler.reset();
        for (LiveMechanism mechanism : mechanisms.values()) {
            try {
                mechanism.stop();
            } catch (RuntimeException ignored) {
                // Stop the rest even if one device fails.
            }
        }
        if (drive != null) {
            try {
                drive.stop();
            } catch (RuntimeException ignored) {
                // The SDK stops the drive motors when the OpMode ends.
            }
        }
    }

    private void setRun(String phase, String reason) {
        synchronized (this) {
            runPhase = phase;
            runReason = reason;
        }
        publish();
    }

    private Map<String, Object> pedro() {
        try {
            Class<?> constants = pedroConstants();
            return constants != null ? PedroHardware.describe(constants) : PedroHardware.describe();
        } catch (RuntimeException | LinkageError e) {
            return null;
        }
    }

    /** Handles a message from the stream: pairing, or a program. Called on the stream's threads. */
    final String receive(StreamServer.Peer from, Map<String, Object> message) {
        String type = Json.string(message, "type", "");
        if ("auth".equals(type)) return pair(from, Json.string(message, "token", null));
        if ("program".equals(type)) return take(from, message.get("program"));
        return null;
    }

    private String pair(StreamServer.Peer from, String token) {
        synchronized (this) {
            if (closed) return error("Lumière Live has stopped.");
            if (pairingProblem != null) return error(pairingProblem);
            Integer failed = failures.get(from);
            if (!matches(token)) {
                int count = failed == null ? 1 : failed + 1;
                failures.put(from, count);
                String reply = error("This computer is not paired with Lumière Live on this robot. Turn on Live runs on this computer in Lumière, deploy, and install the robot code again.");
                if (count < MAX_PAIRING_FAILURES) return reply;
                from.send(reply);
                from.close();
                return null;
            }
            failures.remove(from);
            peer = from;
        }
        publish();
        return null;
    }

    private String take(StreamServer.Peer from, Object json) {
        synchronized (this) {
            if (closed) return error("Lumière Live has stopped.");
            if (peer == null || peer != from) return error("Pair with Lumière Live before sending a program.");
            if (started) return error("Lumière Live has already started. Stop it, then INIT it again on the Driver Station to send another program.");
            if (json == null) return error("The program message has no program.");
            pendingProgram = json;
            state = "checking";
        }
        publish();
        return null;
    }

    /** Called when a connection closes. A running program stops at the next loop. */
    final void disconnected(StreamServer.Peer gone) {
        boolean wasPaired;
        synchronized (this) {
            failures.remove(gone);
            wasPaired = peer == gone;
            if (wasPaired) peer = null;
        }
        if (wasPaired) publish();
    }

    /** Sends the current report to every app: the {@code live} message in docs/protocol.md. */
    private void publish() {
        Map<String, Object> body = Json.object();
        synchronized (this) {
            body.put("opMode", NAME);
            body.put("state", state);
            body.put("started", started);
            body.put("paired", peer != null);
            body.put("dryRun", false);
            body.put("powerCap", cap);
            body.put("silenceMs", (double) SILENCE_MS);
            body.put("program", summary);
            body.put("problems", new ArrayList<Object>(problems));
            body.put("notes", new ArrayList<Object>(notes));
            if (runPhase != null) {
                Map<String, Object> run = Json.object();
                run.put("phase", runPhase);
                run.put("reason", runReason);
                if (runElapsedMs >= 0) run.put("elapsedMs", runElapsedMs);
                body.put("run", run);
            }
        }
        Stream.publish("live", body);
    }

    /** Live data for the app, as a generated OpMode reports it. */
    private void report() {
        if (session == null) return;
        LiveProgram current = acceptedProgram();
        if (current != null) session.data("lumiere.routineRevision", current.revision);
        session.update();
    }

    private void show() {
        String currentState;
        String phase;
        String reason;
        boolean paired;
        Map<String, Object> shown;
        List<String> shownProblems;
        List<String> shownNotes;
        synchronized (this) {
            currentState = state;
            phase = runPhase;
            reason = runReason;
            paired = peer != null;
            shown = summary;
            shownProblems = problems;
            shownNotes = notes;
        }
        telemetry.addLine(NAME + " (mechanism power limit " + HardwareCheck.format(cap) + ")");
        if (pairingProblem != null) telemetry.addLine(pairingProblem);
        telemetry.addData("Paired computer", paired ? "connected" : "not connected");
        if (shown == null) {
            telemetry.addLine("Waiting for a program from the paired computer.");
            return;
        }
        telemetry.addData("Program", shown.get("name") + " (" + shown.get("revision") + ")");
        telemetry.addData("Contents", shown.get("steps") + " steps, " + shown.get("paths") + " paths, " + shown.get("mechanisms") + " mechanisms");
        if (phase != null) {
            telemetry.addData("Run", reason == null ? phase : phase + ": " + reason);
        } else if ("checking".equals(currentState)) {
            telemetry.addData("Check", "checking the robot's hardware");
        } else if ("accepted".equals(currentState)) {
            telemetry.addData("Check", "passed; press START to run it");
        } else {
            telemetry.addData("Check", shownProblems.size() == 1 ? "1 problem" : shownProblems.size() + " problems");
            for (int i = 0; i < Math.min(TELEMETRY_PROBLEMS, shownProblems.size()); i++) telemetry.addLine("- " + shownProblems.get(i));
        }
        if (drive != null && phase != null) {
            Pose pose = drive.pose();
            if (pose != null) {
                telemetry.addData("x (in)", "%.1f", pose.x());
                telemetry.addData("y (in)", "%.1f", pose.y());
                telemetry.addData("heading (deg)", "%.1f", Math.toDegrees(pose.heading()));
            }
        }
        for (LiveMechanism mechanism : mechanisms.values()) {
            String name = mechanism.stateName();
            if (name != null) telemetry.addData(mechanism.mechanism.name, name);
        }
        for (int i = 0; i < Math.min(3, shownNotes.size()); i++) telemetry.addLine("Note: " + shownNotes.get(i));
    }

    /** What the app and the Driver Station show for a program, read even when it has problems. */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> summaryOf(Object json) {
        Map<String, Object> program = json instanceof Map ? (Map<String, Object>) json : Collections.<String, Object>emptyMap();
        Map<String, Object> summary = Json.object();
        Object name = program.get("name");
        Object revision = program.get("revision");
        summary.put("name", name instanceof String ? clip((String) name, 120) : "(unnamed)");
        summary.put("revision", revision instanceof String ? clip((String) revision, 64) : "?");
        summary.put("steps", count(program.get("routine")));
        summary.put("paths", count(program.get("paths")));
        summary.put("mechanisms", count(program.get("mechanisms")));
        return summary;
    }

    private static int count(Object list) {
        return list instanceof List ? ((List<?>) list).size() : 0;
    }

    private static String clip(String text, int max) {
        return text.length() <= max ? text : text.substring(0, max);
    }

    private static String describe(RuntimeException e) {
        String message = e.getMessage();
        return e.getClass().getSimpleName() + (message == null ? "" : ": " + message);
    }

    private boolean matches(String token) {
        if (expectedHash == null || token == null || token.isEmpty() || token.length() > 256) return false;
        return MessageDigest.isEqual(expectedHash, sha256(token));
    }

    static byte[] sha256(String text) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    /** Bytes from hexadecimal digits, or null when the text is not hexadecimal. */
    static byte[] hexBytes(String hex) {
        if (hex == null) return null;
        String digits = hex.trim();
        if (digits.isEmpty() || digits.length() % 2 != 0) return null;
        byte[] bytes = new byte[digits.length() / 2];
        for (int i = 0; i < bytes.length; i++) {
            int high = Character.digit(digits.charAt(2 * i), 16);
            int low = Character.digit(digits.charAt(2 * i + 1), 16);
            if (high < 0 || low < 0) return null;
            bytes[i] = (byte) (high * 16 + low);
        }
        return bytes;
    }

    static String error(String message) {
        Map<String, Object> body = Json.object();
        body.put("message", message);
        return Stream.encode("error", body);
    }
}
