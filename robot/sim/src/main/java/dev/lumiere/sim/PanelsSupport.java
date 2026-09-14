package dev.lumiere.sim;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;

/**
 * Lets OpModes that use Panels run in the simulator.
 *
 * <p>On a Robot Controller, Panels creates its WebSocket in an app start hook. The simulator creates
 * that socket without starting it; with no clients, Panels telemetry and field updates are accepted
 * and discarded. Reflection is used so the simulator works whether or not Panels is installed.
 */
final class PanelsSupport {
    private static volatile boolean prepared;

    private PanelsSupport() {
    }

    static synchronized void prepare() {
        if (prepared) return;
        prepared = true;
        try {
            Class<?> panels = Class.forName("com.bylazar.panels.Panels");
            Object instance = panels.getField("INSTANCE").get(null);
            Class<?> socketClass = Class.forName("com.bylazar.panels.server.Socket");
            Method getSocket = panels.getMethod("getSocket");
            try {
                if (getSocket.invoke(instance) != null) return;
            } catch (java.lang.reflect.InvocationTargetException notInitialized) {
                // A lateinit property throws until it is set, which is the expected case.
            }
            Constructor<?> constructor = socketClass.getConstructor(int.class);
            panels.getMethod("setSocket", socketClass).invoke(instance, constructor.newInstance(0));
        } catch (ClassNotFoundException notInstalled) {
            // Panels is not a dependency of this robot project.
        } catch (ReflectiveOperationException | RuntimeException | LinkageError e) {
            System.err.println("Panels could not be prepared for simulation: " + e);
        }
    }
}
