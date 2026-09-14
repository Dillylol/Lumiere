package dev.lumiere.ftc.internal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import dev.lumiere.ftc.Stream;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.IOException;
import java.net.ServerSocket;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public class StreamServerTest {
    private final OkHttpClient http = new OkHttpClient.Builder().readTimeout(5, TimeUnit.SECONDS).build();
    private StreamServer server;
    private int port;
    private final AtomicInteger stops = new AtomicInteger();

    @Before
    public void startServer() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            port = socket.getLocalPort();
        }
        server = new StreamServer("127.0.0.1", port, "secret-token",
                () -> Arrays.asList(Stream.encode("hello", Json.object())),
                message -> {
                    if ("stop".equals(message.get("type"))) stops.incrementAndGet();
                    return null;
                });
        server.begin();
    }

    @After
    public void stopServer() {
        server.end();
        http.dispatcher().executorService().shutdown();
    }

    private static final class Recorder extends WebSocketListener {
        final BlockingQueue<String> messages = new LinkedBlockingQueue<>();
        final CountDownLatch opened = new CountDownLatch(1);
        final CountDownLatch closed = new CountDownLatch(1);
        volatile Response failure;

        @Override public void onOpen(WebSocket webSocket, Response response) { opened.countDown(); }
        @Override public void onMessage(WebSocket webSocket, String text) { messages.add(text); }
        @Override public void onClosing(WebSocket webSocket, int code, String reason) { closed.countDown(); }
        @Override public void onClosed(WebSocket webSocket, int code, String reason) { closed.countDown(); }
        @Override public void onFailure(WebSocket webSocket, Throwable t, Response response) { failure = response; closed.countDown(); opened.countDown(); }
    }

    private WebSocket connect(Recorder recorder, String origin) {
        Request.Builder request = new Request.Builder().url("ws://127.0.0.1:" + port + Stream.PATH);
        if (origin != null) request.header("Origin", origin);
        return http.newWebSocket(request.build(), recorder);
    }

    @Test
    public void authorizedClientReceivesGreetingBroadcastsAndPongs() throws Exception {
        Recorder recorder = new Recorder();
        WebSocket socket = connect(recorder, "http://tauri.localhost");
        assertTrue(recorder.opened.await(5, TimeUnit.SECONDS));
        assertNull("nothing is sent before authentication", recorder.messages.poll(300, TimeUnit.MILLISECONDS));
        assertFalse(server.hasClients());

        socket.send("{\"type\":\"auth\",\"token\":\"secret-token\"}");
        assertEquals("hello", type(recorder.messages.poll(5, TimeUnit.SECONDS)));
        assertTrue(server.hasClients());

        server.broadcast("{\"type\":\"state\"}");
        assertEquals("state", type(recorder.messages.poll(5, TimeUnit.SECONDS)));

        socket.send("{\"type\":\"ping\",\"t\":42}");
        Map<String, Object> pong = Json.parseObject(recorder.messages.poll(5, TimeUnit.SECONDS));
        assertNotNull(pong);
        assertEquals("pong", pong.get("type"));
        assertEquals(42.0, pong.get("t"));

        socket.send("{\"type\":\"stop\"}");
        long deadline = System.currentTimeMillis() + 5000;
        while (stops.get() == 0 && System.currentTimeMillis() < deadline) Thread.sleep(10);
        assertEquals(1, stops.get());
        socket.close(1000, "done");
    }

    @Test
    public void wrongTokenClosesTheConnection() throws Exception {
        Recorder recorder = new Recorder();
        WebSocket socket = connect(recorder, null);
        assertTrue(recorder.opened.await(5, TimeUnit.SECONDS));
        socket.send("{\"type\":\"auth\",\"token\":\"guess\"}");
        assertTrue(recorder.closed.await(5, TimeUnit.SECONDS));
        assertFalse(server.hasClients());
        assertEquals(0, stops.get());
    }

    @Test
    public void commandsBeforeAuthenticationAreRejected() throws Exception {
        Recorder recorder = new Recorder();
        WebSocket socket = connect(recorder, null);
        assertTrue(recorder.opened.await(5, TimeUnit.SECONDS));
        socket.send("{\"type\":\"stop\"}");
        assertTrue(recorder.closed.await(5, TimeUnit.SECONDS));
        assertEquals(0, stops.get());
    }

    @Test
    public void unauthenticatedClientsTimeOut() throws Exception {
        Recorder recorder = new Recorder();
        connect(recorder, null);
        assertTrue(recorder.opened.await(5, TimeUnit.SECONDS));
        assertTrue(recorder.closed.await(8, TimeUnit.SECONDS));
    }

    @Test
    public void browserPagesFromOtherOriginsAreRefused() throws Exception {
        Recorder recorder = new Recorder();
        connect(recorder, "https://example.com");
        assertTrue(recorder.closed.await(5, TimeUnit.SECONDS));
        assertNotNull(recorder.failure);
        assertEquals(403, recorder.failure.code());
    }

    @Test
    public void originPolicy() {
        assertTrue(StreamServer.originAllowed(null));
        assertTrue(StreamServer.originAllowed("tauri://localhost"));
        assertTrue(StreamServer.originAllowed("http://tauri.localhost"));
        assertTrue(StreamServer.originAllowed("http://localhost:1420"));
        assertFalse(StreamServer.originAllowed("http://localhost.example.com"));
        assertFalse(StreamServer.originAllowed("https://192.168.43.1.evil.test"));
    }

    private static String type(String message) {
        assertNotNull("expected a message", message);
        return (String) Json.parseObject(message).get("type");
    }
}
