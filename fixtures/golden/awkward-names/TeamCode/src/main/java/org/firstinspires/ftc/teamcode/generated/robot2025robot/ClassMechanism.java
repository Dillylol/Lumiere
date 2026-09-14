// GENERATED FILE: edit the "2025 Robot!" project in Lumière instead. To keep hand edits, delete these two lines.
// checksum: 11c72637a2a06cd4
package org.firstinspires.ftc.teamcode.generated.robot2025robot;

import com.pedropathing.ivy.Command;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;

/** The "class" mechanism. */
public class ClassMechanism {
    public enum State {
        STATE1ST_POSITION, STATE1ST_POSITION2, ELEVE_QUOTED
    }

    private final Servo state2;
    private final DcMotor state3;
    private State state = null;

    public ClassMechanism(HardwareMap hardwareMap) {
        state2 = hardwareMap.get(Servo.class, "state");
        state2.setDirection(Servo.Direction.REVERSE);
        state3 = hardwareMap.get(DcMotor.class, "State");
        state3.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
    }

    /** Applies the starting state, STATE1ST_POSITION. Call from init(). */
    public void initialize() {
        set(State.STATE1ST_POSITION);
    }

    /** Sets the mechanism's outputs for a state. */
    public void set(State next) {
        state = next;
        switch (next) {
            case STATE1ST_POSITION:
                state2.setPosition(0.1);
                state3.setPower(0);
                break;
            case STATE1ST_POSITION2:
                state2.setPosition(0.9);
                break;
            case ELEVE_QUOTED:
                state3.setPower(-0.333333);
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
