// GENERATED FILE: edit the "2025 Robot!" project in Lumière instead. To keep hand edits, delete these two lines.
// checksum: 82a3b690d1bd5b80
package org.firstinspires.ftc.teamcode.generated.robot2025robot;

import com.pedropathing.ivy.Command;
import com.qualcomm.robotcore.hardware.HardwareMap;

/** The "Follower" mechanism. */
public class Follower2 {
    public enum State {
    }

    private State state = null;

    public Follower2(HardwareMap hardwareMap) {
    }

    /** This mechanism has no starting state; the hardware is left as it is. */
    public void initialize() {
    }

    /** Sets the mechanism's outputs for a state. */
    public void set(State next) {
        state = next;
        switch (next) {
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
