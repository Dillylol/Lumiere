package dev.lumiere.ftc.live;

import com.pedropathing.ivy.Command;
import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;

import java.util.Set;

/**
 * A device a Live program sets directly, without a mechanism, driven the way a generated autonomous
 * drives the devices it sets directly: the same setup at INIT, the same calls, each power cut to the
 * device's limit, and an encoder target that finishes when the motor gets there. A motor that takes
 * encoder targets must stay within its declared travel.
 */
final class LiveDevice {
    final LiveProgram.Device device;
    /** Whether any of the program's steps sends this motor to an encoder target. */
    private final boolean takesTargets;
    private DcMotor motor;
    private Servo servo;
    private CRServo crServo;

    /**
     * Sets the device up as the generated init() does.
     *
     * @param reset motor names whose encoders were already reset during this INIT; a resent program
     *              must not move a motor's zero
     */
    LiveDevice(LiveProgram.Device device, boolean takesTargets, HardwareMap hardwareMap, Set<String> reset) {
        this.device = device;
        this.takesTargets = takesTargets;
        switch (device.kind) {
            case "motor":
                motor = hardwareMap.get(DcMotor.class, device.name);
                motor.setDirection(device.reversed ? DcMotorSimple.Direction.REVERSE : DcMotorSimple.Direction.FORWARD);
                motor.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
                if (takesTargets && reset.add(device.name)) motor.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
                break;
            case "servo":
                servo = hardwareMap.get(Servo.class, device.name);
                servo.setDirection(device.reversed ? Servo.Direction.REVERSE : Servo.Direction.FORWARD);
                break;
            default:
                crServo = hardwareMap.get(CRServo.class, device.name);
                crServo.setDirection(device.reversed ? DcMotorSimple.Direction.REVERSE : DcMotorSimple.Direction.FORWARD);
        }
    }

    /** Sets an output, with the calls the generated Java makes for it. */
    void set(LiveProgram.Output output) {
        if ("position".equals(output.kind)) {
            servo.setPosition(output.value);
        } else if ("target".equals(output.kind)) {
            motor.setTargetPosition(output.ticks);
            motor.setMode(DcMotor.RunMode.RUN_TO_POSITION);
            motor.setPower(device.limited(output.power));
        } else if (motor != null) {
            // A motor that also takes targets runs on its encoder; power alone needs it back in its normal mode.
            if (takesTargets) motor.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
            motor.setPower(device.limited(output.value));
        } else {
            crServo.setPower(device.limited(output.value));
        }
    }

    /** What a timed step does when its time is up: a servo goes to {@code thenPosition}; anything else stops. */
    void after(double thenPosition) {
        if (servo != null) servo.setPosition(thenPosition);
        else stop();
    }

    /**
     * The command an untimed encoder target runs, as the generated {@code runToTarget}: send the motor to
     * its target, and finish when it gets there.
     */
    Command toTarget(LiveProgram.Output target) {
        return Command.build().setStart(() -> set(target)).setDone(() -> !motor.isBusy());
    }

    /** Motors and continuous servos to zero power; a servo keeps its position. */
    void stop() {
        if (motor != null) motor.setPower(0);
        if (crServo != null) crServo.setPower(0);
    }

    /** Why the motor has left its travel, or null while it is within it. */
    String travelProblem() {
        LiveProgram.Travel travel = device.travel;
        if (travel == null || !takesTargets || motor == null) return null;
        int position = motor.getCurrentPosition();
        double margin = Math.max(LiveMechanism.TRAVEL_MARGIN_TICKS, (travel.maxTicks - travel.minTicks) * LiveMechanism.TRAVEL_MARGIN_SHARE);
        if (position >= travel.minTicks - margin && position <= travel.maxTicks + margin) return null;
        return "\"" + device.name + "\" left its travel: it is at " + position + " ticks, and its travel is " + travel.minTicks + " to " + travel.maxTicks + ".";
    }
}
