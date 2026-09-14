// GENERATED FILE: edit the "Sample Robot" project in Lumière instead. To keep hand edits, delete these two lines.
// checksum: 2b56c303d3523f54
package org.firstinspires.ftc.teamcode.generated.samplerobot;

import com.pedropathing.ivy.Command;
import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.HardwareMap;

/** The "Intake" mechanism. */
public class Intake {
    public enum State {
        IN, OUT, STOP
    }

    private final CRServo intakeLeft;
    private final CRServo intakeRight;
    private State state = null;

    public Intake(HardwareMap hardwareMap) {
        intakeLeft = hardwareMap.get(CRServo.class, "intake_left");
        intakeRight = hardwareMap.get(CRServo.class, "intake_right");
        intakeRight.setDirection(DcMotorSimple.Direction.REVERSE);
    }

    /** Applies the starting state, STOP. Call from init(). */
    public void initialize() {
        set(State.STOP);
    }

    /** Sets the mechanism's outputs for a state. */
    public void set(State next) {
        state = next;
        switch (next) {
            case IN:
                intakeLeft.setPower(1);
                intakeRight.setPower(1);
                break;
            case OUT:
                intakeLeft.setPower(-0.6);
                intakeRight.setPower(-0.6);
                break;
            case STOP:
                intakeLeft.setPower(0);
                intakeRight.setPower(0);
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
