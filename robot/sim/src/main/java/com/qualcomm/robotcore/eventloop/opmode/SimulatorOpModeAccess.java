package com.qualcomm.robotcore.eventloop.opmode;

import com.qualcomm.robotcore.hardware.Gamepad;
import com.qualcomm.robotcore.hardware.HardwareMap;

import org.firstinspires.ftc.robotcore.internal.opmode.OpModeServices;
import org.firstinspires.ftc.robotcore.internal.opmode.TelemetryInternal;

import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Drives an OpMode through the FTC SDK's own lifecycle for the desktop simulator.
 *
 * <p>This class lives in the SDK's package because the lifecycle hooks {@code OpModeManagerImpl}
 * uses are package-private. It makes the same calls in the same order. The one difference is
 * {@link #init}: the SDK's thread pool records native thread ids through Android APIs that do not
 * exist on a desktop JVM, so the OpMode thread is created with a standard executor instead. The
 * body of that thread mirrors {@code OpModeInternal.internalInit} in FTC SDK 12.0.
 */
public final class SimulatorOpModeAccess {
    private final OpMode opMode;
    private final Gamepad gamepad1 = new Gamepad();
    private final Gamepad gamepad2 = new Gamepad();

    public SimulatorOpModeAccess(OpMode opMode) {
        this.opMode = opMode;
    }

    public OpMode opMode() {
        return opMode;
    }

    /** Equivalent to pressing INIT on the Driver Station. */
    public void init(HardwareMap hardwareMap, OpModeServices services) {
        opMode.hardwareMap = hardwareMap;
        opMode.gamepad1 = gamepad1;
        opMode.gamepad2 = gamepad2;
        opMode.internalOpModeServices = services;

        final ExecutorService executor = Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "OpModeThread");
            thread.setDaemon(true);
            return thread;
        });
        opMode.executorService = executor;
        opMode.exception = null;
        opMode.noClassDefFoundError = null;
        opMode.isStarted = false;
        opMode.stopRequested = false;
        opMode.opModeThreadFinished = false;
        if (opMode.telemetry instanceof TelemetryInternal) {
            ((TelemetryInternal) opMode.telemetry).resetTelemetryForOpMode();
        }
        gamepad1.resetEdgeDetection();
        gamepad2.resetEdgeDetection();
        gamepad1.setTriggerThreshold(Gamepad.DEFAULT_TRIGGER_THRESHOLD);
        gamepad2.setTriggerThreshold(Gamepad.DEFAULT_TRIGGER_THRESHOLD);

        executor.execute(() -> {
            try {
                opMode.internalRunOpMode();
            } catch (InterruptedException | CancellationException e) {
                opMode.requestOpModeStop();
            } catch (RuntimeException e) {
                opMode.exception = e;
            } catch (NoClassDefFoundError e) {
                opMode.noClassDefFoundError = e;
            } finally {
                if (opMode.telemetry instanceof TelemetryInternal) {
                    opMode.telemetry.setMsTransmissionInterval(0);
                    ((TelemetryInternal) opMode.telemetry).tryUpdateIfDirty();
                }
                opMode.opModeThreadFinished = true;
            }
        });
    }

    /** Equivalent to pressing START (the play button) on the Driver Station. */
    public void start() {
        opMode.internalStart();
    }

    /**
     * One event-loop iteration: delivers gamepad data, rethrows an exception from the OpMode
     * thread, and wakes a {@link LinearOpMode} that is waiting.
     */
    public void iterate(Gamepad latest1, Gamepad latest2) {
        Gamepad copy1 = new Gamepad();
        copy1.copy(latest1);
        Gamepad copy2 = new Gamepad();
        copy2.copy(latest2);
        opMode.newGamepadDataAvailable(copy1, copy2);
        opMode.internalThrowOpModeExceptionIfPresent();
        opMode.internalOnEventLoopIteration();
    }

    /** How an OpMode responded to STOP. */
    public enum StopResult {
        /** The OpMode returned promptly. */
        STOPPED,
        /** The OpMode ignored the stop request and ended only after its thread was interrupted. */
        INTERRUPTED,
        /** The OpMode thread is still running. */
        STUCK
    }

    /**
     * Equivalent to pressing STOP. Like the SDK, an OpMode that ignores the stop request is
     * interrupted after {@link OpModeInternal#MS_BEFORE_FORCE_STOP_AFTER_STOP_REQUESTED}.
     */
    public StopResult stop() {
        final ExecutorService executor = opMode.executorService;
        if (executor == null) return StopResult.STOPPED;
        Thread stopper = new Thread(opMode::internalStop, "OpModeStop");
        stopper.setDaemon(true);
        stopper.start();
        join(stopper, OpModeInternal.MS_BEFORE_FORCE_STOP_AFTER_STOP_REQUESTED);
        if (!stopper.isAlive()) return StopResult.STOPPED;
        executor.shutdownNow();
        join(stopper, 2000);
        return opMode.opModeThreadFinished ? StopResult.INTERRUPTED : StopResult.STUCK;
    }

    private static void join(Thread thread, long millis) {
        try {
            thread.join(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    public boolean isStarted() {
        return opMode.isStarted;
    }

    public boolean isFinished() {
        return opMode.opModeThreadFinished;
    }

    /** An exception thrown by the OpMode, or null. */
    public Throwable failure() {
        if (opMode.exception != null) return opMode.exception;
        return opMode.noClassDefFoundError;
    }
}
