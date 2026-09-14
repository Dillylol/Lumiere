package org.firstinspires.ftc.teamcode.simulation;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import dev.lumiere.ftc.internal.Json;

import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Checks the editor's completion hints (fixtures/java-hints.json, generated from
 * app/src/core/javaHints/hints.ts) against the FTC SDK, Pedro Pathing, Ivy, Panels, and robot library
 * this project compiles with. CI copies the JSON into src/test/resources.
 */
public class JavaHintsTest {
    @Test
    @SuppressWarnings("unchecked")
    public void everyHintNamesARealMember() throws IOException {
        InputStream stream = JavaHintsTest.class.getResourceAsStream("/java-hints.json");
        assertNotNull("java-hints.json must be on the test classpath", stream);
        List<Object> hints = (List<Object>) Json.parseObject(read(stream)).get("hints");
        assertNotNull(hints);
        assertTrue("hints are present", hints.size() > 50);

        List<String> problems = new ArrayList<>();
        for (Object item : hints) {
            Map<String, Object> hint = (Map<String, Object>) item;
            String owner = (String) hint.get("owner");
            String name = (String) hint.get("name");
            String kind = (String) hint.get("kind");
            String returns = (String) hint.get("returns");
            List<Object> params = (List<Object>) hint.get("params");
            String label = owner + "#" + name + params + " -> " + returns + " (" + kind + ")";

            Class<?> type;
            try {
                type = Class.forName(owner, false, JavaHintsTest.class.getClassLoader());
            } catch (ClassNotFoundException e) {
                problems.add("no class: " + label);
                continue;
            }
            boolean wantStatic = kind.startsWith("static");
            if (kind.endsWith("ield")) {
                try {
                    Field field = type.getField(name);
                    if (Modifier.isStatic(field.getModifiers()) != wantStatic || !matches(field.getType(), returns)) {
                        problems.add("field differs: " + label);
                    }
                } catch (NoSuchFieldException e) {
                    problems.add("no field: " + label);
                }
                continue;
            }
            boolean found = false;
            for (Method method : type.getMethods()) {
                if (!method.getName().equals(name) || method.getParameterCount() != params.size()) continue;
                if (Modifier.isStatic(method.getModifiers()) != wantStatic) continue;
                if (!matches(method.getReturnType(), returns)) continue;
                boolean same = true;
                Class<?>[] types = method.getParameterTypes();
                for (int i = 0; i < types.length && same; i++) same = matches(types[i], (String) params.get(i));
                if (same) {
                    found = true;
                    break;
                }
            }
            if (!found) problems.add("no method: " + label);
        }
        assertTrue(String.join("\n", problems), problems.isEmpty());
    }

    /** Compares a real type with a hint type such as {@code Class<T>}, {@code Command...}, or {@code DcMotor.RunMode}. */
    private static boolean matches(Class<?> actual, String hint) {
        String written = hint.replaceAll("<.*>", "").replace("...", "[]");
        // A single capital letter is a type variable, erased to its bound.
        if (written.matches("[A-Z]")) return !actual.isPrimitive();
        String simple = written.substring(written.lastIndexOf('.') + 1);
        return actual.getSimpleName().equals(simple);
    }

    private static String read(InputStream stream) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        for (int count; (count = stream.read(chunk)) > 0; ) buffer.write(chunk, 0, count);
        stream.close();
        return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
    }
}
