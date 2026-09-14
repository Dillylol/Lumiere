// GENERATED FILE: edit the "Sample Robot" project in Lumière instead. To keep hand edits, delete these two lines.
// checksum: 70c581c504e45142
package org.firstinspires.ftc.teamcode.generated.samplerobot;

import com.pedropathing.ivy.Command;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;

/** The "Claw" mechanism. */
public class Claw {
    public enum State {
        OPEN, CLOSED
    }

    private final Servo claw2;
    private State state = null;

    public Claw(HardwareMap hardwareMap) {
        claw2 = hardwareMap.get(Servo.class, "claw");
    }

    /** Applies the starting state, CLOSED. Call from init(). */
    public void initialize() {
        set(State.CLOSED);
    }

    /** Sets the mechanism's outputs for a state. */
    public void set(State next) {
        state = next;
        switch (next) {
            case OPEN:
                claw2.setPosition(0.8);
                break;
            case CLOSED:
                claw2.setPosition(0.25);
                break;
        }
    }

    /** The most recently set state, or null before the first. */
    public State state() {
        return state;
    }

    /** True while a motor is still moving to its target. */
    public boolean isBusy() {
        return false;
    }

    /** A command that sets a state and finishes when any motor targets are reached. */
    public Command command(State next) {
        return Command.build()
                .setStart(() -> set(next))
                .setDone(() -> !isBusy())
                .requiring(this);
    }
}
