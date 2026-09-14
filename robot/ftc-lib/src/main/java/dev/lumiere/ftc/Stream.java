package dev.lumiere.ftc;

import dev.lumiere.ftc.internal.Json;

import java.util.Map;

/**
 * Sends live robot data to connected apps.
 *
 * <p>On a Robot Controller the transport is a WebSocket server on {@link #ROBOT_PORT}. The desktop
 * simulator installs its own transport, so OpModes report the same way in both places. Messages are
 * documented in docs/protocol.md.
 */
public final class Stream {
    /** Stream protocol version. Increment only for incompatible message changes. */
    public static final int PROTOCOL_VERSION = 1;
    /** WebSocket port on the Robot Controller. */
    public static final int ROBOT_PORT = 58080;
    /** WebSocket path on both the robot and the simulator. */
    public static final String PATH = "/stream";

    /** Receives messages. Implementations must never throw and must not block the caller. */
    public interface Transport {
        boolean hasClients();

        void broadcast(String message);
    }

    private static volatile Transport transport;
    private static volatile String lastManifest;
    private static volatile String lastLifecycle;

    private Stream() {
    }

    public static void install(Transport newTransport) {
        transport = newTransport;
    }

    public static void uninstall(Transport oldTransport) {
        if (transport == oldTransport) transport = null;
    }

    public static boolean hasClients() {
        Transport current = transport;
        return current != null && current.hasClients();
    }

    /** Sends a message object with the given type to every connected client. */
    public static void publish(String type, Map<String, Object> body) {
        Transport current = transport;
        String message = encode(type, body);
        if ("manifest".equals(type)) lastManifest = message;
        if ("lifecycle".equals(type)) lastLifecycle = message;
        if (current == null || !current.hasClients()) return;
        try {
            current.broadcast(message);
        } catch (RuntimeException ignored) {
            // A stream failure must never affect the running OpMode.
        }
    }

    /** The most recent manifest message, replayed to clients that connect later. */
    public static String lastManifest() {
        return lastManifest;
    }

    /** The most recent lifecycle message, replayed to clients that connect later. */
    public static String lastLifecycle() {
        return lastLifecycle;
    }

    public static String encode(String type, Map<String, Object> body) {
        Map<String, Object> message = Json.object();
        message.put("type", type);
        if (body != null) {
            for (Map.Entry<String, Object> entry : body.entrySet()) {
                if (!"type".equals(entry.getKey())) message.put(entry.getKey(), entry.getValue());
            }
        }
        return Json.write(message);
    }

    /** Library version reported in hello messages. */
    public static String libraryVersion() {
        return BuildConfig.LIBRARY_VERSION;
    }
}
