// GENERATED FILE: edit the "Direct Devices" project in Lumière instead. To keep hand edits, delete these two lines.
// checksum: a63e07ee50c12c38
package org.firstinspires.ftc.teamcode.generated.directdevices;

import com.pedropathing.ivy.Command;
import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.HardwareMap;

/** The "Roller" mechanism. */
public class Roller {
    public enum State {
        SPIN, STOP
    }

    private final CRServo roller2;
    private State state = null;

    public Roller(HardwareMap hardwareMap) {
        roller2 = hardwareMap.get(CRServo.class, "roller");
    }

    /** Applies the starting state, STOP. Call from init(). */
    public void initialize() {
        set(State.STOP);
    }

    /** Sets the mechanism's outputs for a state. */
    public void set(State next) {
        state = next;
        switch (next) {
            case SPIN:
                roller2.setPower(0.6); // 1, cut to the power limit on the Robot page
                break;
            case STOP:
                roller2.setPower(0);
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
