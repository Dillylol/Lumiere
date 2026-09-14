package dev.lumiere.ftc.internal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

public class JsonTest {
    @Test
    public void writesNestedValuesWithEscapes() {
        Map<String, Object> object = Json.object();
        object.put("text", "quote \" slash \\ newline \n tab \t control \u0001");
        object.put("whole", 72.0);
        object.put("fraction", 0.125);
        object.put("nan", Double.NaN);
        object.put("flag", true);
        object.put("none", null);
        object.put("list", Arrays.asList(1, "two", new double[]{3.5, 4}));
        assertEquals(
                "{\"text\":\"quote \\\" slash \\\\ newline \\n tab \\t control \\u0001\",\"whole\":72,\"fraction\":0.125,"
                        + "\"nan\":null,\"flag\":true,\"none\":null,\"list\":[1,\"two\",[3.5,4]]}",
                Json.write(object));
    }

    @Test
    @SuppressWarnings("unchecked")
    public void parsesWhatItWrites() {
        Map<String, Object> object = Json.object();
        object.put("name", "Example Auto \u00e9\u2014");
        object.put("pose", Arrays.asList(1.5, -2.0, 3e2));
        object.put("nested", Json.object());
        Map<String, Object> parsed = (Map<String, Object>) Json.parse(Json.write(object));
        assertEquals("Example Auto \u00e9\u2014", parsed.get("name"));
        assertEquals(Arrays.asList(1.5, -2.0, 300.0), parsed.get("pose"));
        assertEquals(Json.object(), parsed.get("nested"));
    }

    @Test
    public void parsesUnicodeEscapesAndWhitespace() {
        Object value = Json.parse(" { \"a\" : [ true , false , null , \"\\u0041\\/\" ] } ");
        assertEquals(Arrays.asList(true, false, null, "A/"), ((Map<?, ?>) value).get("a"));
    }

    @Test
    public void rejectsInvalidJson() {
        for (String text : Arrays.asList("", "{", "{\"a\":}", "[1,]", "\"unterminated", "tru", "{} extra", "{\"a\":\"\u0001\"}")) {
            assertThrows(text, IllegalArgumentException.class, () -> Json.parse(text));
        }
        assertNull(Json.parseObject("[1, 2]"));
        assertNull(Json.parseObject("not json"));
    }

    @Test
    public void rejectsExcessiveNesting() {
        StringBuilder text = new StringBuilder();
        for (int i = 0; i < 100; i++) text.append('[');
        for (int i = 0; i < 100; i++) text.append(']');
        assertThrows(IllegalArgumentException.class, () -> Json.parse(text.toString()));
    }

    @Test
    public void typedAccessorsFallBackForMissingOrWrongTypes() {
        Map<String, Object> map = Json.parseObject("{\"n\": 2.5, \"b\": true, \"s\": \"x\", \"wrong\": \"1\"}");
        assertEquals(2.5, Json.number(map, "n", 0), 0);
        assertEquals(7, Json.number(map, "wrong", 7), 0);
        assertEquals(true, Json.bool(map, "b", false));
        assertEquals("x", Json.string(map, "s", null));
        assertEquals("fallback", Json.string(map, "missing", "fallback"));
        List<Object> empty = Arrays.asList();
        assertEquals("[]", Json.write(empty));
    }
}
