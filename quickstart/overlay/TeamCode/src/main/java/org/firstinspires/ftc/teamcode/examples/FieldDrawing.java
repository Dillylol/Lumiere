package org.firstinspires.ftc.teamcode.examples;

import com.bylazar.field.FieldManager;
import com.bylazar.field.PanelsField;
import com.pedropathing.math.Pose;

/** Draws the robot on the Panels field view using Pedro Pathing coordinates. */
public final class FieldDrawing {
    private static final double ROBOT_RADIUS = 9.0;
    private static FieldManager field;

    private FieldDrawing() {
    }

    public static void drawRobot(Pose pose) {
        if (field == null) {
            field = PanelsField.INSTANCE.getField();
            field.setOffsets(PanelsField.INSTANCE.getPresets().getPEDRO_PATHING());
        }
        field.setStyle("transparent", "#3f51b5", 0.75);
        field.moveCursor(pose.x(), pose.y());
        field.circle(ROBOT_RADIUS);
        field.moveCursor(pose.x(), pose.y());
        field.line(
                pose.x() + ROBOT_RADIUS * Math.cos(pose.heading()),
                pose.y() + ROBOT_RADIUS * Math.sin(pose.heading())
        );
        field.update();
    }
}
