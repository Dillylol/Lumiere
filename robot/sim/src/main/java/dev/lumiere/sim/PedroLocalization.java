package dev.lumiere.sim;

import dev.lumiere.sim.hardware.SimHardware;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Proxy;
import java.util.Collections;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Gives each Pedro Pathing follower in the running OpMode the simulated robot's pose, through Pedro's
 * own {@code Localizer} interface. It does not matter which localizer the team configured: a Pinpoint,
 * OTOS, OctoQuad, two or three dead wheels, or none. The follower simply reads its pose from the
 * simulation, so the simulator works on any robot Pedro Pathing drives.
 *
 * <p>As with the simulated Pinpoint, the follower's pose and the simulated robot's pose are the same
 * thing: setting the pose places the robot there, as a team places the robot where its code says it
 * starts. When a follower is found, the robot is placed at the pose its own localizer already held,
 * usually the start pose the OpMode set.
 *
 * <p>Followers are found in the OpMode's fields and in the fields of the team's own objects it holds,
 * a few levels deep, including static fields. Reflection keeps the simulator independent of the Pedro
 * Pathing version: when this version's classes do not match, followers keep their own localizers.
 */
final class PedroLocalization {
    static final String FOLLOWER = "com.pedropathing.follower.Follower";
    private static final String LOCALIZER = "com.pedropathing.localization.Localizer";
    private static final int MAX_DEPTH = 4;
    /** Objects from these packages are never searched: they are not the team's, and some are large. */
    private static final String[] LIBRARIES = {
            "java.", "javax.", "jdk.", "sun.", "android.", "androidx.", "kotlin.", "kotlinx.", "com.qualcomm.",
            "org.firstinspires.ftc.robotcore.", "org.firstinspires.ftc.robotserver.", "org.firstinspires.ftc.vision.",
            "com.pedropathing.", "dev.lumiere.ftc.", "com.bylazar.", "com.google.", "org.json.", "okhttp3.", "okio.",
            "org.openftc.", "org.opencv.", "fi.iki.elonen.", "org.junit.",
    };

    private final SimHardware.Body body;
    private final Set<Object> followers = Collections.newSetFromMap(new IdentityHashMap<Object, Boolean>());
    private volatile String replaced;

    PedroLocalization(SimHardware.Body body) {
        this.body = body;
    }

    /** Forgets the previous OpMode's followers. */
    synchronized void reset() {
        followers.clear();
        replaced = null;
    }

    /** The class name of the localizer the simulation stands in for, or null before a follower is found. */
    String replaced() {
        return replaced;
    }

    /** Finds the followers the OpMode can reach and gives each one the simulated pose. Cheap to repeat. */
    synchronized void attach(Object opMode) {
        if (opMode == null) return;
        visit(opMode, 0, Collections.newSetFromMap(new IdentityHashMap<Object, Boolean>()), new HashSet<Class<?>>());
    }

    private void visit(Object value, int depth, Set<Object> seen, Set<Class<?>> staticsSeen) {
        if (value == null || depth > MAX_DEPTH || !seen.add(value)) return;
        Class<?> type = value.getClass();
        if (isFollower(type)) {
            substitute(value);
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
                visit(next, depth + 1, seen, staticsSeen);
            }
        }
    }

    private static boolean isFollower(Class<?> type) {
        for (Class<?> c = type; c != null; c = c.getSuperclass()) if (c.getName().equals(FOLLOWER)) return true;
        return false;
    }

    private static boolean isLibrary(String name) {
        for (String prefix : LIBRARIES) if (name.startsWith(prefix)) return true;
        return false;
    }

    private void substitute(Object follower) {
        if (!followers.add(follower)) return;
        try {
            Field field = null;
            for (Class<?> c = follower.getClass(); c != null && field == null; c = c.getSuperclass()) {
                if (c.getName().equals(FOLLOWER)) field = c.getDeclaredField("localizer");
            }
            if (field == null) return;
            field.setAccessible(true);
            Object current = field.get(follower);
            if (current != null && Proxy.isProxyClass(current.getClass()) && Proxy.getInvocationHandler(current) instanceof Simulated) return;
            ClassLoader loader = follower.getClass().getClassLoader();
            Class<?> localizer = Class.forName(LOCALIZER, false, loader);
            Simulated handler = new Simulated(loader, current, current == null ? "none" : current.getClass().getSimpleName());
            field.set(follower, Proxy.newProxyInstance(loader, new Class<?>[]{localizer}, handler));
            replaced = handler.replaces;
        } catch (ReflectiveOperationException | RuntimeException | LinkageError e) {
            // This Pedro Pathing version is shaped differently, so the follower keeps its own localizer.
        }
    }

    /** Reads x, y, and heading from a Pedro Pathing pose, or null when it is not one. */
    static double[] read(Object pose) {
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

    private static double normalize(double radians) {
        double turn = 2 * Math.PI;
        double result = radians % turn;
        return result < 0 ? result + turn : result;
    }

    /** A Pedro Pathing localizer that reports the simulated robot's pose and field-frame velocity. */
    private final class Simulated implements InvocationHandler {
        final String replaces;
        private final Constructor<?> pose;
        private final Constructor<?> velocity;
        private final Method ofVelocity;

        Simulated(ClassLoader loader, Object previous, String replaces) throws ReflectiveOperationException {
            this.replaces = replaces;
            Class<?> poseType = Class.forName("com.pedropathing.math.Pose", false, loader);
            Class<?> velocityType = Class.forName("com.pedropathing.math.Velocity", false, loader);
            Class<?> stateType = Class.forName("com.pedropathing.localization.MotionState", false, loader);
            pose = poseType.getConstructor(double.class, double.class, double.class);
            velocity = velocityType.getConstructor(double.class, double.class, double.class);
            ofVelocity = stateType.getMethod("ofVelocity", poseType, velocityType);
            // Place the robot where the team's own localizer believes it is, usually the start pose the OpMode set.
            double[] start = null;
            if (previous != null) {
                try {
                    start = read(previous.getClass().getMethod("pose").invoke(previous));
                } catch (ReflectiveOperationException | RuntimeException e) {
                    start = null;
                }
            }
            if (start != null) setPose(start[0], start[1], start[2]);
        }

        void setPose(double x, double y, double heading) {
            if (Double.isNaN(x) || Double.isNaN(y) || Double.isNaN(heading)) return;
            body.teleport(x, y, heading);
        }

        /** x, y, heading, then field-frame vx, vy, and angular velocity. */
        double[] reported() {
            return new double[]{body.x(), body.y(), normalize(body.heading()), body.vx(), body.vy(), body.omega()};
        }

        private Object poseOf(double[] r) throws ReflectiveOperationException {
            return pose.newInstance(r[0], r[1], r[2]);
        }

        private Object state() throws ReflectiveOperationException {
            double[] r = reported();
            return ofVelocity.invoke(null, poseOf(r), velocity.newInstance(r[3], r[4], r[5]));
        }

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
            switch (method.getName()) {
                case "state":
                    return state();
                case "pose":
                    return poseOf(reported());
                case "velocity": {
                    double[] r = reported();
                    return velocity.newInstance(r[3], r[4], r[5]);
                }
                case "twist": {
                    Object state = state();
                    return state.getClass().getMethod("twist").invoke(state);
                }
                case "setPose": {
                    double[] p = read(args == null ? null : args[0]);
                    if (p != null) setPose(p[0], p[1], p[2]);
                    return null;
                }
                case "setX":
                case "setY":
                case "setHeading": {
                    double[] r = reported();
                    double value = ((Number) args[0]).doubleValue();
                    if (method.getName().equals("setX")) r[0] = value;
                    else if (method.getName().equals("setY")) r[1] = value;
                    else r[2] = value;
                    setPose(r[0], r[1], r[2]);
                    return null;
                }
                case "reset":
                    setPose(0, 0, 0);
                    return null;
                case "update":
                    return null;
                case "debug": {
                    Map<String, Object> debug = new LinkedHashMap<>();
                    debug.put("simulated", true);
                    debug.put("replaces", replaces);
                    return debug;
                }
                case "toString":
                    return "Lumière simulated localizer (replaces " + replaces + ")";
                case "hashCode":
                    return System.identityHashCode(proxy);
                case "equals":
                    return args != null && proxy == args[0];
                default:
                    return zero(method.getReturnType());
            }
        }

        private Object zero(Class<?> type) {
            if (type == boolean.class) return false;
            if (type == double.class) return 0.0;
            if (type == float.class) return 0f;
            if (type == long.class) return 0L;
            if (type == int.class) return 0;
            if (type == short.class) return (short) 0;
            if (type == byte.class) return (byte) 0;
            if (type == char.class) return (char) 0;
            return null;
        }
    }
}
