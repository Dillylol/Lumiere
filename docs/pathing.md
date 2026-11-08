# Lumière Pathing Visualizer

Open **Pathing** to draw and edit an autonomous program's paths on the field. It works directly on the program, so there is nothing to load or apply: every change is the program, and **Undo** reverses it.

The workspace follows the Pedro Pathing Visualizer's layout:

- **Top bar:** the **File** menu (import a `.pp` file, mirror to the other alliance, or add a mirrored copy), the program's name, **Export**, the **Start, field and robot** settings, and **Preview program**, which opens Simulate.
- **Layers** (left): the program's **Paths**, **Overlays** of your other autonomous programs, the **Robot**'s position, heading and speed during playback, and the **Routine** with each step's estimated time.
- **Field** (middle): the season field with your paths and robot. Tools sit on the left rail and view options on the right, with playback underneath.
- **Inspector** (right): the selected path's properties, or, with nothing selected, the start point, field picture and robot.

Hide either side panel with its panel button to give the field more room. In windows narrower than about 1050 pixels, the field stays on top and the panels sit below it.

## Tools

| Tool | Key | What it does |
| --- | --- | --- |
| Select | Esc | Selects paths and drags points. Esc also clears the selection. |
| Pen | P | Draw a path freehand. The stroke becomes one curved path that continues from the end of the last path; the first stroke in an empty program also sets the start point. |
| Pick a coordinate | C | Shows the field coordinate under the pointer. Click to copy it. |
| Add path | W | Adds a path a short way past the last one. Double-clicking the field with Select adds a path there. |
| Grid | G | Shows grid lines 1, 3, 6 or 12 inches apart, then hides them. Lines are spaced from the tile seams, so a 24-inch spacing would fall on the seams. |
| Snap | | While the grid shows, dragged points snap to its lines. |
| Ruler | R | A ruler with draggable ends that reads its length in inches. |
| Protractor | | A protractor with a draggable arm that reads its angle. Locked, it follows the robot; unlocked, drag its center anywhere. |

## Editing

- **Move points:** drag the start point, a path's end point, or the selected path's control points. A drag is one undo step. Arrow keys nudge the focused point by 1 inch, or 6 inches with Shift.
- **Curves:** **+ Control point** in the Inspector (A) bends the selected path. Edit points by number in the **Points** table, and remove a control point with its ×.
- **Headings:** **Constant** faces one direction, **Linear** turns evenly from a start angle to an end angle, **Tangential** faces along the path (or backwards along it with **Reverse**), and **Piecewise** changes rules partway. A piecewise rule can also face a point.
- **Wait after the path** adds a wait step right after the path in the routine, or changes the one already there.
- **Color** picks one of eight path colors or your own.
- **Delete:** Delete removes the selected control point, or the selected path together with the routine steps that drive it.
- **Order:** paths are driven in list order, and each starts where the one before it ends. Select a path in **Layers › Paths** and move it up or down.
- **Mirror to the other alliance** reflects the program across x = 70.75, the middle of the 141.5-inch field floor that the Visualizer and its field pictures use. **Mirrored copy as a new program** adds a reflected copy instead. Pedro Pathing 3 lets code choose its own axis with `PoseFactory.mirrorX`.
- **Field picture:** BIOBUZZ (with light and dark versions that follow the app's theme), DECODE, INTO THE DEEP, CENTERSTAGE, plain tiles, or your own image. A picture covers six 24-inch tiles, so it extends 1.25 inches under each wall. Your own image is kept on this computer for the project.

## Timing

**Layers › Routine** lists the routine in order, timed by an estimate from the robot profile: Pedro's forward and strafe speeds and coast decelerations, plus the robot's acceleration and turn rate. When the project is linked to an FTC SDK project, those Pedro values come from its constants class. Along each path, speed is limited by:

- **Direction of travel:** strafing is limited by the strafe speed, and diagonal travel by a blend of the forward and strafe speeds.
- **Curvature:** speed is capped at √(acceleration × radius).
- **Heading change:** the heading can't turn faster than the turn rate.

The robot speeds up at its acceleration and brakes at its coast deceleration. It turns in place first when a path starts facing another way, and each path ends with a 100 ms settle.

**Play** (Space) drives the robot along the routine, and **Loop** repeats it. Dots on the playback track mark where each path ends; click one to jump there. The bar shows the time, the total and the distance driven, and the total turns red when the routine runs past the 30-second autonomous period. The desktop simulator runs the real code; Simulate shows it.

## .pp files

**File › Import a .pp file** and **Export › Pedro Pathing file (.pp)** exchange paths with the Pedro Pathing Visualizer's `.pp` format 2.0.0. Opening a file replaces the program's paths and routine, and asks first when the routine has mechanism steps. A file's robot size is noted only when it differs from the project's; its motion settings are the Visualizer's own and are not used. Export leaves out mechanism steps and writes groups in order, because `.pp` has no equivalent. **Export › Copy poses as Pedro code** copies the start pose and each path's end pose as `new Pose(…)` lines.

## Source and credits

The Lumière Pathing Visualizer is a rebuild of the [Pedro Pathing Visualizer](https://github.com/Pedro-Pathing/Visualizer) in React on Lumière's project model, with its layout and field pictures. Code adapted from the Visualizer keeps its Apache License 2.0 and notice. The Visualizer's notice credits Matthew Allen. [third_party/pedro-pathing-visualizer](../third_party/pedro-pathing-visualizer/README.md) lists the adapted files and pictures. The app ships the license and notice and credits the Visualizer under the workspace's name and on the Learn page. Lumière is not affiliated with Pedro Pathing.
