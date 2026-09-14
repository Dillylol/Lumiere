package dev.lumiere.sim;

import com.qualcomm.robotcore.hardware.Gamepad;

import java.util.Map;

/**
 * A snapshot of a gamepad, using the FTC SDK's field names. Sticks are -1 to 1 with up and left
 * negative on the stick's y and x axes, exactly as the SDK reports them.
 */
public final class GamepadState {
    public float leftStickX;
    public float leftStickY;
    public float rightStickX;
    public float rightStickY;
    public float leftTrigger;
    public float rightTrigger;
    public boolean dpadUp;
    public boolean dpadDown;
    public boolean dpadLeft;
    public boolean dpadRight;
    public boolean a;
    public boolean b;
    public boolean x;
    public boolean y;
    public boolean guide;
    public boolean start;
    public boolean back;
    public boolean leftBumper;
    public boolean rightBumper;
    public boolean leftStickButton;
    public boolean rightStickButton;
    public boolean touchpad;

    /** Reads a {@code gamepad} message's {@code state} object. Missing fields are released or centered. */
    public static GamepadState fromMessage(Map<String, Object> state) {
        GamepadState result = new GamepadState();
        if (state == null) return result;
        result.leftStickX = axis(state, "left_stick_x");
        result.leftStickY = axis(state, "left_stick_y");
        result.rightStickX = axis(state, "right_stick_x");
        result.rightStickY = axis(state, "right_stick_y");
        result.leftTrigger = trigger(state, "left_trigger");
        result.rightTrigger = trigger(state, "right_trigger");
        result.dpadUp = button(state, "dpad_up");
        result.dpadDown = button(state, "dpad_down");
        result.dpadLeft = button(state, "dpad_left");
        result.dpadRight = button(state, "dpad_right");
        result.a = button(state, "a");
        result.b = button(state, "b");
        result.x = button(state, "x");
        result.y = button(state, "y");
        result.guide = button(state, "guide");
        result.start = button(state, "start");
        result.back = button(state, "back");
        result.leftBumper = button(state, "left_bumper");
        result.rightBumper = button(state, "right_bumper");
        result.leftStickButton = button(state, "left_stick_button");
        result.rightStickButton = button(state, "right_stick_button");
        result.touchpad = button(state, "touchpad");
        return result;
    }

    void applyTo(Gamepad gamepad) {
        gamepad.left_stick_x = leftStickX;
        gamepad.left_stick_y = leftStickY;
        gamepad.right_stick_x = rightStickX;
        gamepad.right_stick_y = rightStickY;
        gamepad.left_trigger = leftTrigger;
        gamepad.right_trigger = rightTrigger;
        gamepad.left_trigger_pressed = leftTrigger > gamepad.getTriggerThreshold();
        gamepad.right_trigger_pressed = rightTrigger > gamepad.getTriggerThreshold();
        gamepad.dpad_up = dpadUp;
        gamepad.dpad_down = dpadDown;
        gamepad.dpad_left = dpadLeft;
        gamepad.dpad_right = dpadRight;
        gamepad.a = a;
        gamepad.b = b;
        gamepad.x = x;
        gamepad.y = y;
        gamepad.guide = guide;
        gamepad.start = start;
        gamepad.back = back;
        gamepad.left_bumper = leftBumper;
        gamepad.right_bumper = rightBumper;
        gamepad.left_stick_button = leftStickButton;
        gamepad.right_stick_button = rightStickButton;
        gamepad.touchpad = touchpad;
        // PlayStation-style aliases stay consistent with the Xbox-style fields.
        gamepad.cross = a;
        gamepad.circle = b;
        gamepad.square = x;
        gamepad.triangle = y;
        gamepad.share = back;
        gamepad.options = start;
        gamepad.ps = guide;
        gamepad.refreshTimestamp();
    }

    private static float axis(Map<String, Object> state, String key) {
        Object value = state.get(key);
        if (!(value instanceof Number)) return 0f;
        double number = ((Number) value).doubleValue();
        if (Double.isNaN(number)) return 0f;
        return (float) Math.max(-1, Math.min(1, number));
    }

    private static float trigger(Map<String, Object> state, String key) {
        return Math.max(0f, axis(state, key));
    }

    private static boolean button(Map<String, Object> state, String key) {
        return Boolean.TRUE.equals(state.get(key));
    }
}
