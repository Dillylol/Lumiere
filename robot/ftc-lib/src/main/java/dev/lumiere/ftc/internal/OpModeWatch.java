package dev.lumiere.ftc.internal;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;

import dev.lumiere.ftc.Session;
import dev.lumiere.ftc.Stream;

import java.lang.ref.WeakReference;
import java.util.List;
import java.util.Map;

/**
 * While an OpMode is initialized or running, reports what any OpMode can show without its code doing
 * anything, about ten times a second and only while an app is connected:
 *
 * <ul>
 *   <li>the pose of its Pedro Pathing follower, as a {@code state} message, unless the OpMode reports
 *       through {@link Session}, which sends its own</li>
 *   <li>its motors' and continuous servos' powers and its servos' positions, as a {@code devices}
 *       message, from the SDK's record of what it last sent them</li>
 * </ul>
 *
 * <p>It runs on its own thread and only reads, so it can't change what the OpMode does. Any failure
 * leaves that report out.
 */
final class OpModeWatch implements Runnable {
    static final long PERIOD_MS = 100;
    /** How often to look again for a follower until one is found: an OpMode makes it during init. */
    static final long SEARCH_MS = 1000;
    /** A Session that reported this recently is the OpMode's own reporter, so the watch leaves the pose to it. */
    static final long SESSION_QUIET_MS = 500;

    private final OpMode opMode;
    private final String name;
    private final Thread thread;
    private volatile boolean watching = true;
    private WeakReference<Object> follower;
    private long lastSearch;

    OpModeWatch(OpMode opMode, String name) {
        this.opMode = opMode;
        this.name = name;
        thread = new Thread(this, "Lumiere OpMode watch");
        thread.setDaemon(true);
    }

    static OpModeWatch start(OpMode opMode, String name) {
        OpModeWatch watch = new OpModeWatch(opMode, name);
        watch.thread.start();
        return watch;
    }

    void stop() {
        watching = false;
        thread.interrupt();
    }

    @Override
    public void run() {
        while (watching) {
            try {
                if (Stream.hasClients()) report();
            } catch (RuntimeException | LinkageError e) {
                // A report that can't be read is left out; the OpMode is never affected.
            }
            try {
                Thread.sleep(PERIOD_MS);
            } catch (InterruptedException e) {
                return;
            }
        }
    }

    /** One round of reports. Package-visible so the library's tests can run it without the thread. */
    void report() {
        if (!Session.publishedWithin(SESSION_QUIET_MS)) {
            double[] pose = FollowerSearch.pose(follower());
            if (pose != null && !Double.isNaN(pose[0]) && !Double.isNaN(pose[1]) && !Double.isNaN(pose[2])) {
                Map<String, Object> at = Json.object();
                at.put("x", round(pose[0]));
                at.put("y", round(pose[1]));
                at.put("heading", round(pose[2]));
                Map<String, Object> body = Json.object();
                body.put("opMode", name);
                body.put("pose", at);
                Stream.publish("state", body);
            }
        }
        Map<String, Object> devices = DeviceOutputs.read(opMode.hardwareMap);
        if (!devices.isEmpty()) {
            Map<String, Object> body = Json.object();
            body.put("opMode", name);
            body.put("devices", devices);
            Stream.publish("devices", body);
        }
    }

    /** The OpMode's follower, looked for again every second until one is found. */
    private Object follower() {
        Object known = follower == null ? null : follower.get();
        if (known != null) return known;
        long now = System.currentTimeMillis();
        if (now - lastSearch < SEARCH_MS) return null;
        lastSearch = now;
        List<Object> found = FollowerSearch.find(opMode);
        if (found.isEmpty()) return null;
        follower = new WeakReference<>(found.get(0));
        return found.get(0);
    }

    private static double round(double value) {
        return Math.round(value * 1000.0) / 1000.0;
    }
}
