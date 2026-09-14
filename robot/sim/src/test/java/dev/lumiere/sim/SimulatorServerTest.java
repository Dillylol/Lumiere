package dev.lumiere.sim;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import dev.lumiere.ftc.Stream;
import dev.lumiere.ftc.internal.Json;
import dev.lumiere.sim.testbed.TestConstants;

import org.junit.Test;

import java.net.ServerSocket;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/** Exercises the simulator the way the app does: over the stream protocol. */
public class SimulatorServerTest {
    private static final String TOKEN = "0123456789abcdef-test";

    @Test
    public void appControlsTheSimulatorOverTheStream() throws Exception {
        int port;
        try (ServerSocket socket = new ServerSocket(0)) {
            port = socket.getLocalPort();
        }
        SimulatorConfig config = new SimulatorConfig();
        config.packagePrefix = "dev.lumiere.sim.testbed";
        config.constantsClass = TestConstants.class.getName();
        Simulator simulator = new Simulator("127.0.0.1", port, TOKEN, config);
        Thread runner = new Thread(() -> {
            try {
                simulator.run();
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });
        runner.setDaemon(true);
        runner.start();

        OkHttpClient http = new OkHttpClient.Builder().readTimeout(10, TimeUnit.SECONDS).build();
        BlockingQueue<Map<String, Object>> messages = new LinkedBlockingQueue<>();
        CountDownLatch opened = new CountDownLatch(1);
        WebSocket socket = null;
        for (int attempt = 0; attempt < 50 && socket == null; attempt++) {
            CountDownLatch failed = new CountDownLatch(1);
            WebSocket candidate = http.newWebSocket(new Request.Builder().url("ws://127.0.0.1:" + port + Stream.PATH).build(), new WebSocketListener() {
                @Override public void onOpen(WebSocket webSocket, Response response) { opened.countDown(); }
                @Override public void onMessage(WebSocket webSocket, String text) { messages.add(Json.parseObject(text)); }
                @Override public void onFailure(WebSocket webSocket, Throwable t, Response response) { failed.countDown(); }
            });
            if (opened.await(200, TimeUnit.MILLISECONDS)) socket = candidate;
            else failed.await(200, TimeUnit.MILLISECONDS);
        }
        assertNotNull("connected", socket);
        socket.send("{\"type\":\"auth\",\"token\":\"" + TOKEN + "\"}");

        Map<String, Object> hello = next(messages, m -> "hello".equals(m.get("type")));
        assertEquals("simulator", hello.get("source"));
        assertEquals(1.0, hello.get("protocol"));
        Map<String, Object> manifest = next(messages, m -> "manifest".equals(m.get("type")));
        assertTrue(Json.write(manifest), Json.write(manifest.get("opModes")).contains("Test Path Auto"));
        assertTrue(Json.write(manifest), Json.write(manifest.get("devices")).contains("\"fl\""));

        socket.send("{\"type\":\"init\",\"opMode\":\"Test Path Auto\"}");
        next(messages, m -> "lifecycle".equals(m.get("type")) && "init".equals(m.get("phase")));
        socket.send("{\"type\":\"start\"}");
        next(messages, m -> "lifecycle".equals(m.get("type")) && "running".equals(m.get("phase")));
        next(messages, m -> "path".equals(m.get("type")) && ((List<?>) m.get("points")).size() > 10);
        Map<String, Object> moving = next(messages, m -> "robot".equals(m.get("type"))
                && ((Number) ((Map<?, ?>) m.get("pose")).get("x")).doubleValue() > 30);
        assertEquals("Test Path Auto", moving.get("opMode"));
        next(messages, m -> "telemetry".equals(m.get("type")) && !((List<?>) m.get("lines")).isEmpty());

        socket.send("{\"type\":\"stop\"}");
        next(messages, m -> "lifecycle".equals(m.get("type")) && "stopped".equals(m.get("phase")));

        socket.send("{\"type\":\"init\",\"opMode\":\"Does Not Exist\"}");
        Map<String, Object> error = next(messages, m -> "error".equals(m.get("type")));
        assertTrue(String.valueOf(error.get("message")).contains("Does Not Exist"));

        socket.send("{\"type\":\"shutdown\"}");
        runner.join(10_000);
        assertTrue("simulator exited", !runner.isAlive());
        http.dispatcher().executorService().shutdown();
    }

    private static Map<String, Object> next(BlockingQueue<Map<String, Object>> queue, Predicate<Map<String, Object>> match) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 15_000;
        while (System.currentTimeMillis() < deadline) {
            Map<String, Object> message = queue.poll(deadline - System.currentTimeMillis(), TimeUnit.MILLISECONDS);
            if (message != null && match.test(message)) return message;
        }
        throw new AssertionError("Expected message did not arrive");
    }
}
