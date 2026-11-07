package dev.lumiere.devtools.virtualhub.faults;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.util.ElapsedTime;

import dev.lumiere.ftc.Session;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * OpModes that misbehave on purpose, for the virtual hub's shakedown. They live outside the robot
 * project's package, so they are listed only when the hub is started with faults enabled.
 */
public final class FaultOpModes {
    private FaultOpModes() {
    }

    /** Throws from loop() one second after START, as a jammed mechanism's code might. */
    @Autonomous(name = "Fault: Throws In Loop", group = "Virtual hub")
    public static class ThrowsInLoop extends OpMode {
        private final ElapsedTime sinceStart = new ElapsedTime();

        @Override public void init() { }

        @Override public void start() {
            sinceStart.reset();
        }

        @Override public void loop() {
            telemetry.addData("running for", sinceStart.seconds());
            if (sinceStart.seconds() > 1) throw new IllegalStateException("intake jammed (virtual hub fault)");
        }
    }

    /** Throws from init(), as code that reads a missing device would. */
    @Autonomous(name = "Fault: Throws In Init", group = "Virtual hub")
    public static class ThrowsInInit extends OpMode {
        @Override public void init() {
            throw new IllegalStateException("arm encoder missing (virtual hub fault)");
        }

        @Override public void loop() { }
    }

    /** A LinearOpMode that reports a counter through Session until STOP. */
    @TeleOp(name = "Fault: Linear Counter", group = "Virtual hub")
    public static class LinearCounter extends LinearOpMode {
        @Override
        public void runOpMode() {
            Session session = Session.attach(this);
            waitForStart();
            int count = 0;
            while (opModeIsActive()) {
                session.data("count", count++);
                session.update();
                sleep(20);
            }
            session.close();
        }
    }

    /** Ignores opModeIsActive(), so STOP only ends it when the SDK interrupts the OpMode thread. */
    @TeleOp(name = "Fault: Ignores Stop", group = "Virtual hub")
    public static class IgnoresStop extends LinearOpMode {
        @Override
        public void runOpMode() throws InterruptedException {
            waitForStart();
            while (true) Thread.sleep(50);
        }
    }

    /** Reports values that are awkward to put in JSON. */
    @TeleOp(name = "Fault: Odd Data", group = "Virtual hub")
    public static class OddData extends OpMode {
        private Session session;

        @Override public void init() {
            session = Session.attach(this);
        }

        @Override public void loop() {
            Map<String, Object> nested = new LinkedHashMap<>();
            nested.put("inner", 1);
            Map<Integer, String> keyed = new LinkedHashMap<>();
            keyed.put(1, "one");
            session.data("nan", Double.NaN)
                    .data("infinity", Double.POSITIVE_INFINITY)
                    .data("missing", null)
                    .data("text", "quote \" backslash \\ newline \n tab \t accent é check ✓")
                    .data("list", Arrays.asList(1, 2.5, "x"))
                    .data("map", nested)
                    .data("flag", true)
                    .data("big", Long.MAX_VALUE)
                    .data("array", new int[]{1, 2, 3})
                    .data("keyed", keyed);
            session.update();
        }
    }
}
