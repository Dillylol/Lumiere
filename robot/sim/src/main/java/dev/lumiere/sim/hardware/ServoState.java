package dev.lumiere.sim.hardware;

import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.Servo;

/** The simulated state of a positional servo or a continuous-rotation servo. */
public final class ServoState {
    public final String name;
    public final boolean continuous;

    volatile double position = Double.NaN;
    volatile double power;
    volatile double scaleMin;
    volatile double scaleMax = 1;
    volatile Servo.Direction direction = Servo.Direction.FORWARD;
    volatile DcMotorSimple.Direction crDirection = DcMotorSimple.Direction.FORWARD;
    volatile boolean pwmEnabled = true;

    public ServoState(String name, boolean continuous) {
        this.name = name;
        this.continuous = continuous;
    }

    /** Sets the commanded position in the user's scaled range, as {@link Servo#setPosition} does. */
    void setPosition(double requested) {
        position = Math.max(0, Math.min(1, requested));
    }

    /** The commanded position, or NaN before the first command (a real servo does not move until then). */
    public double position() {
        return position;
    }

    /** The physical PWM position in [0, 1], after direction and scale range. */
    public double physicalPosition() {
        if (Double.isNaN(position)) return Double.NaN;
        double scaled = scaleMin + position * (scaleMax - scaleMin);
        return direction == Servo.Direction.REVERSE ? 1 - scaled : scaled;
    }

    public double power() {
        double sign = crDirection == DcMotorSimple.Direction.REVERSE ? -1 : 1;
        return Math.max(-1, Math.min(1, power)) * sign;
    }
}
