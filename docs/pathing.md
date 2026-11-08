# Lumière Pathing Visualizer

Open **Pathing** to draw and edit an autonomous program's paths on the field. It works directly on the program, so there is nothing to load or apply: every change is the program, and **Undo** reverses it.

## Editing

- **Add a path:** double-click the field, use **Add path**, or turn on **Click to add** (W) and click. A new path keeps the robot's heading, and the routine drives it last.
- **Move points:** drag the start pose, a path's end point, or the selected path's curve handles. A drag is one undo step. Arrow keys nudge the focused point by 1 inch, or 6 inches with Shift. **Snap** rounds to a grid.
- **Curves:** **Add curve handle** (A) bends the selected path. Remove a handle from the path's properties.
- **Headings:** a path can turn evenly from one heading to another, face one direction, face along the path (or backwards along it), or change rules partway with piecewise rules. A piecewise rule can also face a point.
- **Delete:** Delete removes the selected curve handle, or the selected path together with the routine steps that drive it.
- **Order:** paths are driven in list order, and each starts where the one before it ends. Move them up and down in **Paths**.
- **Mirror** reflects the program across x = 72, the middle of Pedro Pathing's 144-inch field coordinates, for the other alliance. **Mirrored copy** adds a reflected copy as a new program. Pedro Pathing 3 lets code choose its own axis with `PoseFactory.mirrorX`; the Pedro Pathing Visualizer uses 70.75, the middle of a 141.5-inch field interior.
- **Field image** shows your own field picture under the paths, stretched to the 144-inch field. It is kept on this computer for the project.

## Timing

The timeline shows the routine in order, timed by an estimate from the robot profile: Pedro's forward and strafe speeds and coast decelerations, plus the robot's acceleration and turn rate. When the project is linked to an FTC SDK project, those Pedro values come from its constants class. Along each path, speed is limited by:

- **Direction of travel:** strafing is limited by the strafe speed, and diagonal travel by a blend of the forward and strafe speeds.
- **Curvature:** speed is capped at √(acceleration × radius).
- **Heading change:** the heading can't turn faster than the turn rate.

The robot speeds up at its acceleration and brakes at its coast deceleration. It turns in place first when a path starts facing another way, and each path ends with a 100 ms settle. **Play** drives the robot along the routine, and the label warns when the routine runs past the 30-second autonomous period. The desktop simulator runs the real code; Simulate shows it.

## .pp files

**Import .pp** and **Export .pp** exchange paths with the Pedro Pathing Visualizer's `.pp` format 2.0.0. Opening a file replaces the program's paths and routine, and asks first when the routine has mechanism steps. A file's robot size is noted only when it differs from the project's; its motion settings are the Visualizer's own and are not used. Export leaves out mechanism steps and writes groups in order, because `.pp` has no equivalent.

## Source and credits

The Lumière Pathing Visualizer is a rebuild of the [Pedro Pathing Visualizer](https://github.com/Pedro-Pathing/Visualizer) in React on Lumière's project model. Code adapted from the Visualizer keeps its Apache License 2.0 and notice. The Visualizer's notice credits Matthew Allen. [third_party/pedro-pathing-visualizer](../third_party/pedro-pathing-visualizer/README.md) lists the adapted files. The app ships the license and notice and credits the Visualizer on the Learn page. Lumière is not affiliated with Pedro Pathing.
