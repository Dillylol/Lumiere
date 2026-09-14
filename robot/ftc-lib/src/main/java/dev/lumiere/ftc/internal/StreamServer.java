package dev.lumiere.ftc.internal;

import dev.lumiere.ftc.Stream;

import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import fi.iki.elonen.NanoHTTPD;
import fi.iki.elonen.NanoWSD;

/**
 * WebSocket server for the stream protocol, shared by the Robot Controller and the desktop simulator.
 *
 * <p>Browsers always send an Origin header, so connections from arbitrary web pages are refused.
 * When a token is configured, a client receives nothing and cannot send commands until its first
 * message is {@code {"type":"auth","token":"..."}}. Clients that stop sending pings are disconnected.
 */
public class StreamServer extends NanoWSD implements Stream.Transport {
    /** Handles a text message from a client. Return a reply message, or null for none. */
    public interface MessageHandler {
        String onMessage(Map<String, Object> message);
    }

    /** Supplies messages sent to each client when it connects. */
    public interface Greeting {
        List<String> messages();
    }

    private static final long CLIENT_TIMEOUT_MS = 10_000;
    private static final long AUTH_TIMEOUT_MS = 3_000;

    private final List<Client> clients = new CopyOnWriteArrayList<>();
    private final List<Client> pending = new CopyOnWriteArrayList<>();
    private final String token;
    private final Greeting greeting;
    private final MessageHandler handler;
    private volatile Thread watchdog;

    /**
     * @param hostname address to bind, or null for all interfaces
     * @param token    token required in the client's first message, or null when not required
     */
    public StreamServer(String hostname, int port, String token, Greeting greeting, MessageHandler handler) {
        super(hostname, port);
        this.token = token;
        this.greeting = greeting;
        this.handler = handler;
    }

    /** Starts the server and the idle-client watchdog. */
    public void begin() throws IOException {
        start(NanoHTTPD.SOCKET_READ_TIMEOUT, true);
        Thread thread = new Thread(this::watch, "stream-watchdog");
        thread.setDaemon(true);
        watchdog = thread;
        thread.start();
    }

    /** Stops the server and closes every client. */
    public void end() {
        Thread thread = watchdog;
        watchdog = null;
        if (thread != null) thread.interrupt();
        for (Client client : clients) client.closeQuietly();
        for (Client client : pending) client.closeQuietly();
        clients.clear();
        pending.clear();
        stop();
    }

    @Override
    public boolean hasClients() {
        return !clients.isEmpty();
    }

    @Override
    public void broadcast(String message) {
        for (Client client : clients) client.sendQuietly(message);
    }

    public int clientCount() {
        return clients.size();
    }

    @Override
    protected Response serveHttp(IHTTPSession session) {
        return newFixedLengthResponse(Response.Status.NOT_FOUND, NanoHTTPD.MIME_PLAINTEXT, "Not found");
    }

    @Override
    public Response serve(IHTTPSession session) {
        if (!Stream.PATH.equals(session.getUri())) {
            return newFixedLengthResponse(Response.Status.NOT_FOUND, NanoHTTPD.MIME_PLAINTEXT, "Not found");
        }
        if (!originAllowed(session.getHeaders().get("origin"))) {
            return newFixedLengthResponse(Response.Status.FORBIDDEN, NanoHTTPD.MIME_PLAINTEXT, "Origin not allowed");
        }
        return super.serve(session);
    }

    /** Allows non-browser clients (no Origin), the desktop app, and local development servers. */
    static boolean originAllowed(String origin) {
        if (origin == null || origin.isEmpty()) return true;
        String value = origin.toLowerCase(Locale.ROOT);
        return value.equals("tauri://localhost")
                || value.equals("http://tauri.localhost")
                || value.equals("https://tauri.localhost")
                || value.startsWith("http://localhost:")
                || value.startsWith("http://127.0.0.1:");
    }

    static boolean constantTimeEquals(String expected, String actual) {
        if (expected == null || actual == null || expected.length() != actual.length()) return false;
        int difference = 0;
        for (int i = 0; i < expected.length(); i++) difference |= expected.charAt(i) ^ actual.charAt(i);
        return difference == 0;
    }

    @Override
    protected WebSocket openWebSocket(IHTTPSession handshake) {
        return new Client(handshake);
    }

    private void watch() {
        while (!Thread.currentThread().isInterrupted()) {
            long now = System.currentTimeMillis();
            for (Client client : clients) {
                if (now - client.lastHeard > CLIENT_TIMEOUT_MS) client.closeQuietly();
            }
            for (Client client : pending) {
                if (now - client.lastHeard > AUTH_TIMEOUT_MS) client.closeQuietly();
            }
            try {
                Thread.sleep(500);
            } catch (InterruptedException e) {
                return;
            }
        }
    }

    private final class Client extends WebSocket {
        volatile long lastHeard = System.currentTimeMillis();

        Client(IHTTPSession handshake) {
            super(handshake);
        }

        @Override
        protected void onOpen() {
            lastHeard = System.currentTimeMillis();
            if (token == null) authorize();
            else pending.add(this);
        }

        private void authorize() {
            pending.remove(this);
            clients.add(this);
            if (greeting != null) {
                for (String message : greeting.messages()) sendQuietly(message);
            }
        }

        @Override
        protected void onClose(WebSocketFrame.CloseCode code, String reason, boolean initiatedByRemote) {
            clients.remove(this);
            pending.remove(this);
        }

        @Override
        protected void onMessage(WebSocketFrame message) {
            lastHeard = System.currentTimeMillis();
            Map<String, Object> parsed = Json.parseObject(message.getTextPayload());
            if (!clients.contains(this)) {
                boolean valid = parsed != null
                        && "auth".equals(parsed.get("type"))
                        && constantTimeEquals(token, Json.string(parsed, "token", null));
                if (valid) authorize();
                else closeQuietly();
                return;
            }
            if (parsed == null) return;
            if ("ping".equals(parsed.get("type"))) {
                Map<String, Object> pong = Json.object();
                pong.put("t", parsed.get("t"));
                sendQuietly(Stream.encode("pong", pong));
                return;
            }
            if (handler == null) return;
            try {
                String reply = handler.onMessage(parsed);
                if (reply != null) sendQuietly(reply);
            } catch (RuntimeException e) {
                Map<String, Object> error = Json.object();
                error.put("message", String.valueOf(e.getMessage()));
                sendQuietly(Stream.encode("error", error));
            }
        }

        @Override
        protected void onPong(WebSocketFrame pong) {
            lastHeard = System.currentTimeMillis();
        }

        @Override
        protected void onException(IOException exception) {
            clients.remove(this);
            pending.remove(this);
        }

        void sendQuietly(String text) {
            try {
                send(text);
            } catch (IOException | RuntimeException e) {
                clients.remove(this);
            }
        }

        void closeQuietly() {
            clients.remove(this);
            pending.remove(this);
            try {
                close(WebSocketFrame.CloseCode.GoingAway, "Closed", false);
            } catch (IOException | RuntimeException ignored) {
                // Already closed.
            }
        }
    }
}
