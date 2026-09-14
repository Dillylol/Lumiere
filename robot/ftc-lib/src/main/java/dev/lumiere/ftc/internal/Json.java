package dev.lumiere.ftc.internal;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Minimal JSON support for the stream protocol. It avoids pulling a JSON library onto the Robot
 * Controller, and it does not depend on Android's org.json (which is unavailable on a desktop JVM).
 */
public final class Json {
    private Json() {
    }

    /** Serializes maps, lists, arrays, strings, numbers, booleans, and null. */
    public static String write(Object value) {
        StringBuilder out = new StringBuilder();
        append(out, value);
        return out.toString();
    }

    public static Map<String, Object> object() {
        return new LinkedHashMap<>();
    }

    @SuppressWarnings("unchecked")
    private static void append(StringBuilder out, Object value) {
        if (value == null) {
            out.append("null");
        } else if (value instanceof String || value instanceof Character || value instanceof Enum) {
            appendString(out, value.toString());
        } else if (value instanceof Boolean) {
            out.append(value.toString());
        } else if (value instanceof Double || value instanceof Float) {
            double number = ((Number) value).doubleValue();
            if (Double.isNaN(number) || Double.isInfinite(number)) out.append("null");
            else if (number == Math.rint(number) && Math.abs(number) < 1e15) out.append((long) number);
            else out.append(number);
        } else if (value instanceof Number) {
            out.append(value.toString());
        } else if (value instanceof Map) {
            out.append('{');
            boolean first = true;
            for (Map.Entry<String, Object> entry : ((Map<String, Object>) value).entrySet()) {
                if (!first) out.append(',');
                first = false;
                appendString(out, entry.getKey());
                out.append(':');
                append(out, entry.getValue());
            }
            out.append('}');
        } else if (value instanceof Iterable) {
            out.append('[');
            boolean first = true;
            for (Object item : (Iterable<Object>) value) {
                if (!first) out.append(',');
                first = false;
                append(out, item);
            }
            out.append(']');
        } else if (value instanceof double[]) {
            out.append('[');
            double[] numbers = (double[]) value;
            for (int i = 0; i < numbers.length; i++) {
                if (i > 0) out.append(',');
                append(out, numbers[i]);
            }
            out.append(']');
        } else if (value instanceof Object[]) {
            List<Object> items = new ArrayList<>();
            for (Object item : (Object[]) value) items.add(item);
            append(out, items);
        } else {
            appendString(out, value.toString());
        }
    }

    private static void appendString(StringBuilder out, String text) {
        out.append('"');
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                case '\b': out.append("\\b"); break;
                case '\f': out.append("\\f"); break;
                default:
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) out.append(String.format("\\u%04x", (int) c));
                    else out.append(c);
            }
        }
        out.append('"');
    }

    /**
     * Parses JSON into maps (insertion ordered), lists, strings, doubles, booleans, and null.
     *
     * @throws IllegalArgumentException if the text is not valid JSON
     */
    public static Object parse(String text) {
        Parser parser = new Parser(text);
        parser.skipWhitespace();
        Object value = parser.value(0);
        parser.skipWhitespace();
        if (parser.position != text.length()) throw parser.error("Unexpected trailing characters");
        return value;
    }

    /** Parses a JSON object, or returns null when the text is not an object. */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObject(String text) {
        try {
            Object value = parse(text);
            return value instanceof Map ? (Map<String, Object>) value : null;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    public static double number(Map<String, Object> map, String key, double fallback) {
        Object value = map.get(key);
        return value instanceof Number ? ((Number) value).doubleValue() : fallback;
    }

    public static boolean bool(Map<String, Object> map, String key, boolean fallback) {
        Object value = map.get(key);
        return value instanceof Boolean ? (Boolean) value : fallback;
    }

    public static String string(Map<String, Object> map, String key, String fallback) {
        Object value = map.get(key);
        return value instanceof String ? (String) value : fallback;
    }

    private static final class Parser {
        private static final int MAX_DEPTH = 32;
        private final String text;
        private int position;

        Parser(String text) {
            this.text = text;
        }

        IllegalArgumentException error(String message) {
            return new IllegalArgumentException(message + " at position " + position);
        }

        void skipWhitespace() {
            while (position < text.length() && Character.isWhitespace(text.charAt(position))) position++;
        }

        Object value(int depth) {
            if (depth > MAX_DEPTH) throw error("Nesting too deep");
            if (position >= text.length()) throw error("Unexpected end of input");
            char c = text.charAt(position);
            switch (c) {
                case '{': return object(depth);
                case '[': return array(depth);
                case '"': return string();
                case 't': return literal("true", Boolean.TRUE);
                case 'f': return literal("false", Boolean.FALSE);
                case 'n': return literal("null", null);
                default:
                    if (c == '-' || (c >= '0' && c <= '9')) return number();
                    throw error("Unexpected character '" + c + "'");
            }
        }

        private Object literal(String word, Object result) {
            if (!text.startsWith(word, position)) throw error("Invalid literal");
            position += word.length();
            return result;
        }

        private Map<String, Object> object(int depth) {
            Map<String, Object> map = new LinkedHashMap<>();
            position++;
            skipWhitespace();
            if (peek('}')) {
                position++;
                return map;
            }
            while (true) {
                skipWhitespace();
                if (!peek('"')) throw error("Expected object key");
                String key = string();
                skipWhitespace();
                expect(':');
                skipWhitespace();
                map.put(key, value(depth + 1));
                skipWhitespace();
                if (peek(',')) {
                    position++;
                } else {
                    expect('}');
                    return map;
                }
            }
        }

        private List<Object> array(int depth) {
            List<Object> list = new ArrayList<>();
            position++;
            skipWhitespace();
            if (peek(']')) {
                position++;
                return list;
            }
            while (true) {
                skipWhitespace();
                list.add(value(depth + 1));
                skipWhitespace();
                if (peek(',')) {
                    position++;
                } else {
                    expect(']');
                    return list;
                }
            }
        }

        private String string() {
            expect('"');
            StringBuilder out = new StringBuilder();
            while (true) {
                if (position >= text.length()) throw error("Unterminated string");
                char c = text.charAt(position++);
                if (c == '"') return out.toString();
                if (c == '\\') {
                    if (position >= text.length()) throw error("Unterminated escape");
                    char escaped = text.charAt(position++);
                    switch (escaped) {
                        case '"': out.append('"'); break;
                        case '\\': out.append('\\'); break;
                        case '/': out.append('/'); break;
                        case 'b': out.append('\b'); break;
                        case 'f': out.append('\f'); break;
                        case 'n': out.append('\n'); break;
                        case 'r': out.append('\r'); break;
                        case 't': out.append('\t'); break;
                        case 'u':
                            if (position + 4 > text.length()) throw error("Invalid unicode escape");
                            try {
                                out.append((char) Integer.parseInt(text.substring(position, position + 4), 16));
                            } catch (NumberFormatException e) {
                                throw error("Invalid unicode escape");
                            }
                            position += 4;
                            break;
                        default:
                            throw error("Invalid escape");
                    }
                } else if (c < 0x20) {
                    throw error("Control character in string");
                } else {
                    out.append(c);
                }
            }
        }

        private Double number() {
            int start = position;
            if (peek('-')) position++;
            while (position < text.length() && "0123456789.eE+-".indexOf(text.charAt(position)) >= 0) position++;
            try {
                return Double.valueOf(text.substring(start, position));
            } catch (NumberFormatException e) {
                throw error("Invalid number");
            }
        }

        private boolean peek(char c) {
            return position < text.length() && text.charAt(position) == c;
        }

        private void expect(char c) {
            if (!peek(c)) throw error("Expected '" + c + "'");
            position++;
        }
    }
}
