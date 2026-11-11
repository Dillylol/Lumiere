package dev.lumiere.ftc.internal;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Set;

/**
 * Finds the Pedro Pathing followers an OpMode can reach, and reads their poses, without the OpMode's
 * code doing anything. Followers are found in the OpMode's fields and in the fields of the team's own
 * objects it holds, a few levels deep, including static fields. Reflection keeps this independent of
 * the Pedro Pathing version: when a version's classes are shaped differently, nothing is found.
 *
 * <p>The robot library uses it to report the pose of any OpMode that doesn't report through
 * {@code Session}; the desktop simulator uses it to give each follower the simulated pose.
 */
public final class FollowerSearch {
    public static final String FOLLOWER = "com.pedropathing.follower.Follower";
    private static final int MAX_DEPTH = 4;
    /** Lumière Live's package: the robot library's own OpMode, which runs the team's follower. */
    private static final String LIVE = "dev.lumiere.ftc.live.";
    /** Objects from these packages are never searched: they are not the team's, and some are large. */
    private static final String[] LIBRARIES = {
            "java.", "javax.", "jdk.", "sun.", "android.", "androidx.", "kotlin.", "kotlinx.", "com.qualcomm.",
            "org.firstinspires.ftc.robotcore.", "org.firstinspires.ftc.robotserver.", "org.firstinspires.ftc.vision.",
            "com.pedropathing.", "dev.lumiere.ftc.", "com.bylazar.", "com.google.", "org.json.", "okhttp3.", "okio.",
            "org.openftc.", "org.opencv.", "fi.iki.elonen.", "org.junit.",
    };

    private FollowerSearch() {
    }

    /** Every follower the object can reach, each once, in the order found. */
    public static List<Object> find(Object root) {
        List<Object> found = new ArrayList<>();
        if (root != null) visit(root, 0, Collections.newSetFromMap(new IdentityHashMap<Object, Boolean>()), new HashSet<Class<?>>(), found);
        return found;
    }

    private static void visit(Object value, int depth, Set<Object> seen, Set<Class<?>> staticsSeen, List<Object> found) {
        if (value == null || depth > MAX_DEPTH || !seen.add(value)) return;
        Class<?> type = value.getClass();
        if (isFollower(type)) {
            found.add(value);
            return;
        }
        if (type.isArray() || type.isEnum() || isLibrary(type.getName())) return;
        for (Class<?> c = type; c != null && !isLibrary(c.getName()); c = c.getSuperclass()) {
            boolean firstVisit = staticsSeen.add(c);
            for (Field field : c.getDeclaredFields()) {
                if (field.getType().isPrimitive()) continue;
                boolean isStatic = Modifier.isStatic(field.getModifiers());
                if (isStatic && !firstVisit) continue;
                Object next;
                try {
                    field.setAccessible(true);
                    next = field.get(isStatic ? null : value);
                } catch (IllegalAccessException | RuntimeException e) {
                    continue;
                }
                visit(next, depth + 1, seen, staticsSeen, found);
            }
        }
    }

    public static boolean isFollower(Class<?> type) {
        for (Class<?> c = type; c != null; c = c.getSuperclass()) if (c.getName().equals(FOLLOWER)) return true;
        return false;
    }

    private static boolean isLibrary(String name) {
        // Lumière Live holds the team's follower inside the robot library, so its objects are searched.
        if (name.startsWith(LIVE)) return false;
        for (String prefix : LIBRARIES) if (name.startsWith(prefix)) return true;
        return false;
    }

    /** A follower's pose as x, y and heading (radians), or null when it has none or is shaped differently. */
    public static double[] pose(Object follower) {
        if (follower == null) return null;
        try {
            Method method;
            try {
                method = follower.getClass().getMethod("pose");
            } catch (NoSuchMethodException e) {
                method = follower.getClass().getMethod("getPose");
            }
            return readPose(method.invoke(follower));
        } catch (ReflectiveOperationException | RuntimeException | LinkageError e) {
            return null;
        }
    }

    /** Reads x, y, and heading from a Pedro Pathing pose, or null when it is not one. */
    public static double[] readPose(Object pose) {
        if (pose == null) return null;
        try {
            return new double[]{number(pose, "x", "getX"), number(pose, "y", "getY"), number(pose, "heading", "getHeading")};
        } catch (ReflectiveOperationException | RuntimeException e) {
            return null;
        }
    }

    private static double number(Object target, String name, String fallback) throws ReflectiveOperationException {
        Method method;
        try {
            method = target.getClass().getMethod(name);
        } catch (NoSuchMethodException e) {
            method = target.getClass().getMethod(fallback);
        }
        return ((Number) method.invoke(target)).doubleValue();
    }
}
