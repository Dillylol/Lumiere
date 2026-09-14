// GENERATED FILE: edit the "Sample Robot" project in Lumière instead. To keep hand edits, delete these two lines.
// checksum: bdd5bc3859357c26
package org.firstinspires.ftc.teamcode.generated.samplerobot;

import com.pedropathing.ivy.Command;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.HardwareMap;

/** The "Lift" mechanism. */
public class Lift {
    public enum State {
        DOWN, HIGH_BASKET, HOLD
    }

    private final DcMotor liftMotor;
    private State state = null;

    public Lift(HardwareMap hardwareMap) {
        liftMotor = hardwareMap.get(DcMotor.class, "lift_motor");
        liftMotor.setDirection(DcMotorSimple.Direction.REVERSE);
        liftMotor.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
        liftMotor.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
    }

    /** This mechanism has no starting state; the hardware is left as it is. */
    public void initialize() {
    }

    /** Sets the mechanism's outputs for a state. */
    public void set(State next) {
        state = next;
        switch (next) {
            case DOWN:
                liftMotor.setTargetPosition(0);
                liftMotor.setMode(DcMotor.RunMode.RUN_TO_POSITION);
                liftMotor.setPower(0.8);
                break;
            case HIGH_BASKET:
                liftMotor.setTargetPosition(1800);
                liftMotor.setMode(DcMotor.RunMode.RUN_TO_POSITION);
                liftMotor.setPower(1);
                break;
            case HOLD:
                liftMotor.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
                liftMotor.setPower(0.1);
                break;
        }
    }

    /** The most recently set state, or null before the first. */
    public State state() {
        return state;
    }

    /** True while a motor is still moving to its target. */
    public boolean isBusy() {
        return liftMotor.isBusy();
    }

    /** A command that sets a state and finishes when any motor targets are reached. */
    public Command command(State next) {
        return Command.build()
                .setStart(() -> set(next))
                .setDone(() -> !isBusy())
                .requiring(this);
    }
}
