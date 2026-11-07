package dev.lumiere.devtools.virtualhub;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManager;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerImpl;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerNotifier;
import com.qualcomm.robotcore.hardware.HardwareMap;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Stands in for the Robot Controller's {@link OpModeManagerImpl}. It overrides every method the robot
 * library calls, so none of the SDK manager's own state is used, and it notifies listeners in the
 * order the SDK 12.0 manager does (checked against its bytecode):
 * <ul>
 *   <li>INIT: the new OpMode becomes active, then {@code onOpModePreInit}.</li>
 *   <li>START: {@code onOpModePreStart}.</li>
 *   <li>STOP: {@code onOpModePostStop} while the stopping OpMode is still active, then the SDK's
 *       default OpMode ({@value OpModeManager#DEFAULT_OP_MODE_NAME}) becomes active and is initialized
 *       and started like any other.</li>
 * </ul>
 * Created with {@link #create}, never with its constructor.
 */
final class VirtualOpModeManager extends OpModeManagerImpl {
    /** The SDK's default OpMode, which runs between team OpModes and must never be reported. */
    static final class StopRobot extends OpMode {
        @Override public void init() { }
        @Override public void loop() { }
    }

    private List<OpModeManagerNotifier.Notifications> listeners;
    private volatile String activeName;
    private volatile OpMode activeOpMode;
    private OpMode stopRobot;
    private Runnable stopHandler;

    private VirtualOpModeManager() {
        super(null, null); // Never runs: see create().
    }

    /** @param stopHandler called when a stop is requested for the active team OpMode; must not block */
    static VirtualOpModeManager create(Runnable stopHandler) {
        VirtualOpModeManager manager = Instances.withoutConstructor(VirtualOpModeManager.class);
        manager.listeners = new CopyOnWriteArrayList<>();
        manager.stopRobot = new StopRobot();
        manager.activeName = OpModeManager.DEFAULT_OP_MODE_NAME;
        manager.activeOpMode = manager.stopRobot;
        manager.stopHandler = stopHandler;
        return manager;
    }

    @Override
    public OpMode registerListener(OpModeManagerNotifier.Notifications listener) {
        if (listener != null && !listeners.contains(listener)) listeners.add(listener);
        return activeOpMode;
    }

    @Override
    public void unregisterListener(OpModeManagerNotifier.Notifications listener) {
        listeners.remove(listener);
    }

    @Override
    public String getActiveOpModeName() {
        return activeName;
    }

    @Override
    public OpMode getActiveOpMode() {
        return activeOpMode;
    }

    @Override
    public void requestOpModeStop(OpMode opMode) {
        if (opMode != null && opMode == activeOpMode && opMode != stopRobot) stopHandler.run();
    }

    int listenerCount() {
        return listeners.size();
    }

    /**
     * The end of Robot Controller startup: once OpModes are registered and the hardware map exists, the
     * SDK initializes and starts its default OpMode, which receives the configured hardware map like
     * any OpMode.
     */
    void startDefaultOpMode(HardwareMap hardwareMap) {
        stopRobot.hardwareMap = hardwareMap;
        activeName = OpModeManager.DEFAULT_OP_MODE_NAME;
        activeOpMode = stopRobot;
        for (OpModeManagerNotifier.Notifications listener : listeners) listener.onOpModePreInit(stopRobot);
        for (OpModeManagerNotifier.Notifications listener : listeners) listener.onOpModePreStart(stopRobot);
    }

    void initializing(String name, OpMode opMode) {
        activeName = name;
        activeOpMode = opMode;
        for (OpModeManagerNotifier.Notifications listener : listeners) listener.onOpModePreInit(opMode);
    }

    void starting() {
        OpMode current = activeOpMode;
        for (OpModeManagerNotifier.Notifications listener : listeners) listener.onOpModePreStart(current);
    }

    void stopped() {
        OpMode stopping = activeOpMode;
        if (stopping == stopRobot) return;
        for (OpModeManagerNotifier.Notifications listener : listeners) listener.onOpModePostStop(stopping);
        activeName = OpModeManager.DEFAULT_OP_MODE_NAME;
        activeOpMode = stopRobot;
        for (OpModeManagerNotifier.Notifications listener : listeners) listener.onOpModePreInit(stopRobot);
        for (OpModeManagerNotifier.Notifications listener : listeners) listener.onOpModePreStart(stopRobot);
    }
}
