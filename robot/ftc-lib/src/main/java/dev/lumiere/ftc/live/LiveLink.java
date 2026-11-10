package dev.lumiere.ftc.live;

import dev.lumiere.ftc.internal.StreamServer;

import java.util.Map;

/**
 * Connects the robot's stream to Lumière Live while it is initialized or running. The robot library's
 * stream hooks call it; teams never do.
 */
public final class LiveLink {
    private static final Object LOCK = new Object();
    private static LiveRunner open;

    private LiveLink() {
    }

    static void open(LiveRunner runner) {
        synchronized (LOCK) {
            open = runner;
        }
    }

    static void close(LiveRunner runner) {
        synchronized (LOCK) {
            if (open == runner) open = null;
        }
    }

    /**
     * Handles {@code auth} (pairing) and {@code program} messages.
     *
     * @return the reply for the sender, or null for none
     */
    public static String handle(StreamServer.Peer peer, Map<String, Object> message) {
        LiveRunner runner;
        synchronized (LOCK) {
            runner = open;
        }
        if (runner == null) {
            return LiveRunner.error("Lumière Live is not running. Choose " + LiveRunner.NAME + " on the Driver Station and press INIT, then send the program again.");
        }
        return runner.receive(peer, message);
    }

    /** Tells Lumière Live that a connection closed, so it stops counting on that computer. */
    public static void disconnected(StreamServer.Peer peer) {
        LiveRunner runner;
        synchronized (LOCK) {
            runner = open;
        }
        if (runner != null) runner.disconnected(peer);
    }
}
