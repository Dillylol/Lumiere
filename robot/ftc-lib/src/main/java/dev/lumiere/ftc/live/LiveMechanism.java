package dev.lumiere.ftc.live;

import com.pedropathing.ivy.Command;
import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * A mechanism from a Live program, driven the way the generated mechanism class drives it: the same
 * device setup, the same calls for each state, and the same command. Two things differ:
 *
 * <ul>
 *   <li>powers are capped at the runner's limit</li>
 *   <li>motors that take encoder targets must stay within their declared travel</li>
 * </ul>
 */
final class LiveMechanism {
    /** How far past its travel a motor may go, as a share of the travel, before Lumière Live stops the run. */
    static final double TRAVEL_MARGIN_SHARE = 0.05;
    /** The smallest margin, in ticks, so a motor settling at its limit is not mistaken for one running away. */
    static final int TRAVEL_MARGIN_TICKS = 20;

    final LiveProgram.Mechanism mechanism;
    private final double cap;
    private final Map<String, DcMotor> motors = new LinkedHashMap<>();
    private final Map<String, Servo> servos = new LinkedHashMap<>();
    private final Map<String, CRServo> crServos = new LinkedHashMap<>();
    private final Set<String> targetMotors = new HashSet<>();
    private LiveProgram.State state;

    /**
     * Sets up the devices as the generated constructor does.
     *
     * @param reset motor names whose encoders were already reset during this INIT; a resent program
     *              must not move a motor's zero
     */
    LiveMechanism(LiveProgram.Mechanism mechanism, HardwareMap hardwareMap, double cap, Set<String> reset) {
        this.mechanism = mechanism;
        this.cap = cap;
        for (LiveProgram.State candidate : mechanism.states) {
            for (Map.Entry<String, LiveProgram.Output> entry : candidate.outputs.entrySet()) {
                if ("target".equals(entry.getValue().kind)) targetMotors.add(entry.getKey());
            }
        }
        for (LiveProgram.Device device : mechanism.devices) {
            switch (device.kind) {
                case "motor": {
                    DcMotor motor = hardwareMap.get(DcMotor.class, device.name);
                    motor.setDirection(device.reversed ? DcMotorSimple.Direction.REVERSE : DcMotorSimple.Direction.FORWARD);
                    motor.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
                    if (targetMotors.contains(device.id) && reset.add(device.name)) motor.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
                    motors.put(device.id, motor);
                    break;
                }
                case "servo": {
                    Servo servo = hardwareMap.get(Servo.class, device.name);
                    servo.setDirection(device.reversed ? Servo.Direction.REVERSE : Servo.Direction.FORWARD);
                    servos.put(device.id, servo);
                    break;
                }
                default: {
                    CRServo crServo = hardwareMap.get(CRServo.class, device.name);
                    crServo.setDirection(device.reversed ? DcMotorSimple.Direction.REVERSE : DcMotorSimple.Direction.FORWARD);
                    crServos.put(device.id, crServo);
                }
            }
        }
    }

    /** Applies the starting state, as a generated OpMode does in init(). */
    void initialize() {
        if (mechanism.initialState == null) return;
        for (LiveProgram.State candidate : mechanism.states) {
            if (candidate.id.equals(mechanism.initialState)) set(candidate);
        }
    }

    /** Sets a state's outputs, in the order the generated {@code set} sets them. */
    void set(LiveProgram.State next) {
        state = next;
        for (LiveProgram.Device device : mechanism.devices) {
            LiveProgram.Output output = next.outputs.get(device.id);
            if (output == null) continue;
            if ("position".equals(output.kind)) {
                servos.get(device.id).setPosition(output.value);
            } else if ("power".equals(output.kind)) {
                DcMotor motor = motors.get(device.id);
                if (motor != null) {
                    if (targetMotors.contains(device.id)) motor.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
                    motor.setPower(capped(output.value));
                } else {
                    crServos.get(device.id).setPower(capped(output.value));
                }
            } else {
                DcMotor motor = motors.get(device.id);
                motor.setTargetPosition(output.ticks);
                motor.setMode(DcMotor.RunMode.RUN_TO_POSITION);
                motor.setPower(capped(output.power));
            }
        }
    }

    /** True while a motor is still moving to its target. */
    boolean isBusy() {
        for (String id : targetMotors) {
            DcMotor motor = motors.get(id);
            if (motor != null && motor.isBusy()) return true;
        }
        return false;
    }

    /** The command a generated mechanism builds: set the state, then wait for any targets. */
    Command command(LiveProgram.State next) {
        return Command.build().setStart(() -> set(next)).setDone(() -> !isBusy()).requiring(this);
    }

    /** Motors and continuous servos to zero power; servos keep their position. */
    void stop() {
        for (DcMotor motor : motors.values()) motor.setPower(0);
        for (CRServo crServo : crServos.values()) crServo.setPower(0);
    }

    /** Why a motor has left its travel, or null while every one is within it. */
    String travelProblem() {
        for (LiveProgram.Device device : mechanism.devices) {
            LiveProgram.Travel travel = device.travel;
            if (travel == null || !targetMotors.contains(device.id)) continue;
            int position = motors.get(device.id).getCurrentPosition();
            double margin = Math.max(TRAVEL_MARGIN_TICKS, (travel.maxTicks - travel.minTicks) * TRAVEL_MARGIN_SHARE);
            if (position < travel.minTicks - margin || position > travel.maxTicks + margin) {
                return "\"" + device.name + "\" in " + mechanism.name + " left its travel: it is at " + position + " ticks, and its travel is "
                        + travel.minTicks + " to " + travel.maxTicks + ".";
            }
        }
        return null;
    }

    /** The most recently set state's name, or null before the first. */
    String stateName() {
        return state == null ? null : state.name;
    }

    private double capped(double power) {
        return Math.max(-cap, Math.min(cap, power));
    }
}
