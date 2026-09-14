package dev.lumiere.ftc;

import com.pedropathing.follower.Follower;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import dev.lumiere.ftc.internal.Json;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Reports an OpMode's pose, path, and values to connected apps.
 *
 * <pre>{@code
 * session = Session.attach(this).follower(follower);
 * // in loop():
 * session.data("intake", intake.state());
 * session.update();
 * }</pre>
 *
 * <p>Reporting is rate limited and is skipped entirely when no app is connected. A reporting error
 * disables the session instead of reaching the OpMode.
 */
public final class Session {
    private static final long PUBLISH_INTERVAL_NANOS = 50_000_000L;
    private static final int PATH_SAMPLES = 64;

    private final String opModeName;
    private final Map<String, Object> data = new LinkedHashMap<>();
    private Follower follower;
    private Path lastPath;
    private long lastPublishNanos;
    private long lastUpdateNanos;
    private double loopMs;
    private boolean disabled;

    private Session(String opModeName) {
        this.opModeName = opModeName;
    }

    /** Creates a session for the OpMode, named as it appears on the Driver Station. */
    public static Session attach(OpMode opMode) {
        return new Session(displayName(opMode));
    }

    /** Includes the follower's pose, target, and current path in each report. */
    public Session follower(Follower follower) {
        this.follower = follower;
        return this;
    }

    /** Adds a value to the next report. Values are shown by name in the app. */
    public Session data(String name, Object value) {
        if (name != null) data.put(name, value);
        return this;
    }

    /** Call once per loop. Sends at most 20 reports per second. */
    public void update() {
        if (disabled) return;
        long now = System.nanoTime();
        if (lastUpdateNanos != 0) {
            double sample = (now - lastUpdateNanos) / 1e6;
            loopMs = loopMs == 0 ? sample : loopMs * 0.9 + sample * 0.1;
        }
        lastUpdateNanos = now;
        if (!Stream.hasClients() || now - lastPublishNanos < PUBLISH_INTERVAL_NANOS) return;
        lastPublishNanos = now;
        try {
            publish();
        } catch (RuntimeException | LinkageError e) {
            disabled = true;
        } finally {
            data.clear();
        }
    }

    /** Sends a final report. */
    public void close() {
        if (disabled || !Stream.hasClients()) return;
        try {
            publish();
        } catch (RuntimeException | LinkageError e) {
            disabled = true;
        }
    }

    private void publish() {
        Map<String, Object> body = Json.object();
        body.put("opMode", opModeName);
        body.put("loopMs", round(loopMs));
        if (follower != null) {
            body.put("pose", pose(follower.pose()));
            body.put("follower", follower.mode().name().toLowerCase(java.util.Locale.ROOT));
            if (follower.following()) {
                Pose target = follower.closestPose();
                if (target != null) body.put("target", pose(target));
            }
            Path path = follower.currentPath();
            if (path != null && path != lastPath) {
                lastPath = path;
                Stream.publish("path", pathBody(path));
            }
        }
        if (!data.isEmpty()) body.put("data", new LinkedHashMap<>(data));
        Stream.publish("state", body);
    }

    static Map<String, Object> pathBody(Path path) {
        List<Object> points = new ArrayList<>();
        for (int i = 0; i <= PATH_SAMPLES; i++) {
            Pose point = path.get((double) i / PATH_SAMPLES);
            points.add(new double[]{round(point.x()), round(point.y())});
        }
        Map<String, Object> body = Json.object();
        body.put("points", points);
        return body;
    }

    static Map<String, Object> pose(Pose pose) {
        Map<String, Object> map = Json.object();
        map.put("x", round(pose.x()));
        map.put("y", round(pose.y()));
        map.put("heading", round(pose.heading()));
        return map;
    }

    static double round(double value) {
        return Math.round(value * 1000.0) / 1000.0;
    }

    static String displayName(OpMode opMode) {
        Class<?> type = opMode.getClass();
        Autonomous autonomous = type.getAnnotation(Autonomous.class);
        if (autonomous != null && !autonomous.name().isEmpty()) return autonomous.name();
        TeleOp teleOp = type.getAnnotation(TeleOp.class);
        if (teleOp != null && !teleOp.name().isEmpty()) return teleOp.name();
        return type.getSimpleName();
    }
}
