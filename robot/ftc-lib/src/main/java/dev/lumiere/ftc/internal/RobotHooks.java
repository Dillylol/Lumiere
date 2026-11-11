package dev.lumiere.ftc.internal;

import android.annotation.SuppressLint;
import android.content.Context;

import com.qualcomm.ftccommon.FtcEventLoop;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManager;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerImpl;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerNotifier;
import com.qualcomm.robotcore.util.RobotLog;

import org.firstinspires.ftc.ftccommon.external.OnCreateEventLoop;
import org.firstinspires.ftc.ftccommon.external.OnDestroy;
import org.firstinspires.ftc.robotcore.internal.opmode.OpModeMeta;
import org.firstinspires.ftc.robotcore.internal.opmode.RegisteredOpModes;

import dev.lumiere.ftc.Manifest;
import dev.lumiere.ftc.Stream;
import dev.lumiere.ftc.live.LiveLink;
import dev.lumiere.ftc.live.LiveProgram;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Starts the stream server when the Robot Controller's event loop is created. The FTC SDK finds
 * these methods through their annotations; teams do not call them.
 *
 * <p>The server accepts {@code stop}, which asks the SDK to stop the active OpMode exactly as the
 * Driver Station's stop button does. While the Driver Station has Lumière Live initialized, a
 * computer paired with it may also pair ({@code auth}) and send a {@code program}, which Lumière Live
 * checks and, when the Driver Station presses START, runs. Nothing received over the network can start
 * an OpMode.
 */
public final class RobotHooks {
    private static final String TAG = "RobotStream";
    private static final Object LOCK = new Object();
    private static StreamServer server;
    // Held only between the event loop's creation and destruction, and cleared in onDestroy.
    @SuppressLint("StaticFieldLeak")
    private static OpModeManagerImpl manager;
    private static Lifecycle lifecycle;
    /** Reports the active OpMode's pose and device outputs while it is initialized or running. */
    private static OpModeWatch watch;

    private RobotHooks() {
    }

    @OnCreateEventLoop
    public static void onCreateEventLoop(Context context, FtcEventLoop eventLoop) {
        synchronized (LOCK) {
            shutdown();
            manager = eventLoop.getOpModeManager();
            lifecycle = new Lifecycle();
            manager.registerListener(lifecycle);
            server = new StreamServer(null, Stream.ROBOT_PORT, null, RobotHooks::greeting, new StreamServer.PeerHandler() {
                @Override
                public String onMessage(StreamServer.Peer peer, Map<String, Object> message) {
                    return RobotHooks.onMessage(peer, message);
                }

                @Override
                public void onDisconnect(StreamServer.Peer peer) {
                    LiveLink.disconnected(peer);
                }
            });
            try {
                server.begin();
                Stream.install(server);
            } catch (IOException e) {
                RobotLog.ee(TAG, e, "Could not start the stream server on port %d", Stream.ROBOT_PORT);
                server = null;
            }
        }
    }

    @OnDestroy
    public static void onDestroy(Context context) {
        synchronized (LOCK) {
            shutdown();
        }
    }

    private static void shutdown() {
        unwatch();
        if (server != null) {
            Stream.uninstall(server);
            server.end();
            server = null;
        }
        if (manager != null && lifecycle != null) manager.unregisterListener(lifecycle);
        manager = null;
        lifecycle = null;
    }

    private static List<String> greeting() {
        List<String> messages = new ArrayList<>();
        Map<String, Object> hello = Json.object();
        hello.put("protocol", Stream.PROTOCOL_VERSION);
        hello.put("source", "robot");
        hello.put("library", Stream.libraryVersion());
        // What this robot library can do beyond the stream: Lumière Live, with the program format it reads.
        Map<String, Object> capabilities = Json.object();
        capabilities.put("live", (double) LiveProgram.FORMAT);
        hello.put("capabilities", capabilities);
        messages.add(Stream.encode("hello", hello));
        String manifest = Stream.lastManifest();
        messages.add(manifest != null ? manifest : Stream.encode("manifest", Manifest.build(null, registeredOpModes())));
        String state = Stream.lastLifecycle();
        if (state != null) messages.add(state);
        String live = Stream.lastLive();
        if (live != null) messages.add(live);
        return messages;
    }

    private static String onMessage(StreamServer.Peer peer, Map<String, Object> message) {
        Object type = message.get("type");
        if ("auth".equals(type) || "program".equals(type)) return LiveLink.handle(peer, message);
        if (!"stop".equals(type)) return null;
        OpModeManagerImpl current;
        synchronized (LOCK) {
            current = manager;
        }
        if (current == null) return null;
        OpMode active = current.getActiveOpMode();
        if (active != null && !OpModeManager.DEFAULT_OP_MODE_NAME.equals(current.getActiveOpModeName())) {
            current.requestOpModeStop(active);
        }
        return null;
    }

    private static void watch(OpMode opMode, String name) {
        synchronized (LOCK) {
            if (watch != null) watch.stop();
            watch = OpModeWatch.start(opMode, name);
        }
    }

    private static void unwatch() {
        synchronized (LOCK) {
            if (watch != null) watch.stop();
            watch = null;
        }
    }

    static List<Manifest.OpModeInfo> registeredOpModes() {
        List<Manifest.OpModeInfo> list = new ArrayList<>();
        try {
            for (OpModeMeta meta : RegisteredOpModes.getInstance().getOpModes()) {
                if (meta.flavor == OpModeMeta.Flavor.SYSTEM) continue;
                list.add(new Manifest.OpModeInfo(meta.name, meta.group, meta.flavor.name().toLowerCase(Locale.ROOT)));
            }
        } catch (RuntimeException e) {
            RobotLog.ww(TAG, "OpMode list unavailable: %s", e.getMessage());
        }
        return list;
    }

    private static final class Lifecycle implements OpModeManagerNotifier.Notifications {
        @Override
        public void onOpModePreInit(OpMode opMode) {
            // The Robot Controller calls onCreateEventLoop before it registers OpModes and builds the
            // hardware map, so an app that connects early receives an incomplete manifest. The SDK
            // initializes its own default OpMode once both are ready, and again after every stop, so
            // the manifest is refreshed then too, without a lifecycle message.
            Stream.publish("manifest", Manifest.build(opMode.hardwareMap, registeredOpModes()));
            if (isSystem()) return;
            publish("init");
            OpModeManagerImpl current = manager;
            watch(opMode, current == null ? null : current.getActiveOpModeName());
        }

        @Override
        public void onOpModePreStart(OpMode opMode) {
            if (!isSystem()) publish("running");
        }

        @Override
        public void onOpModePostStop(OpMode opMode) {
            unwatch();
            if (!isSystem()) publish("stopped");
        }

        private boolean isSystem() {
            OpModeManagerImpl current = manager;
            return current == null || OpModeManager.DEFAULT_OP_MODE_NAME.equals(current.getActiveOpModeName());
        }

        private void publish(String phase) {
            OpModeManagerImpl current = manager;
            Map<String, Object> body = Json.object();
            body.put("opMode", current == null ? null : current.getActiveOpModeName());
            body.put("phase", phase);
            Stream.publish("lifecycle", body);
        }
    }
}
