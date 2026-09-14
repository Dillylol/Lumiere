# Hardware checklist

The automated checks (see [compatibility](compatibility.md)) prove that projects compile against FTC SDK
12.0 and that the real Java runs correctly in the desktop simulator. They cannot prove what happens on a
physical robot. Work through this list the first time a robot runs a project, and again after changing
the drivetrain, the odometry pods, or library versions.

## What only a real robot can confirm

| Area | Why the simulator cannot confirm it | Covered by step |
| --- | --- | --- |
| Motor and odometry-pod directions | The simulator assumes the directions in `Constants.java` are right | 3, 4 |
| Pinpoint over I2C | The simulator substitutes a software Pinpoint | 4 |
| Tuned path-following constants | Starting values are simulator estimates | 5 |
| Loop timing on the Control Hub | Desktop loops run faster and more evenly | 6 |
| Panels, AutoTune, and live data on robot Wi-Fi | Their servers only run on the Robot Controller | 2, 5, 7 |
| Deploying with adb over Wi-Fi | Needs a Control Hub | 2 |

## Before powering on

- Charge the battery; below about 12.5 V, tuning results are unreliable.
- Update the Driver Station app to match FTC SDK 12.0. Use the REV Hardware Client to update Control Hub software if it asks.
- Put the robot on a stand so the wheels spin freely.
- Keep a hand near the Driver Station's STOP button for every step below.

## Steps

1. **Hardware configuration.** On the Driver Station, create and activate a configuration containing:
   - the four drive motors: `left_front_drive`, `right_front_drive`, `left_back_drive`, `right_back_drive`
   - a goBILDA Pinpoint named `pinpoint` on an I2C port

   If you use other names, change them in `Constants.java` first.
2. **Deploy.**
   1. Join the laptop to the robot's Wi-Fi.
   2. Deploy from the app, or run `adb connect 192.168.43.1:5555` and then `gradlew :TeamCode:installDebug`.
   3. Confirm the Driver Station lists **Example Auto** and **Example TeleOp**.
   4. Confirm the app's Robot view shows the robot library version.
   5. Confirm telemetry warns that the constants are not tuned yet.
3. **Motor directions** (robot on the stand). Run the **Mecanum** procedure from AutoTune at <http://192.168.43.1:10158>. Every wheel must spin forward when commanded forward. Paste the result into `drivetrainConfig`.
4. **Odometry directions** (robot on the floor, pushed by hand). Run the **Pinpoint** procedure and check these readings:
   - pushing forward increases x
   - pushing left increases y
   - turning counterclockwise increases heading

   Paste the result into `localizerConfig`.
5. **Path following.**
   1. Clear at least one full field tile around the robot.
   2. Run the **Foresight** procedure, then **Tests**: line, curve, and hold.
   3. Paste the Foresight result into `foresightConfig` and set `TUNED = true`.
6. **Example Auto.** Place the robot at the start pose in `ExampleAuto.java`, facing +x.
   1. Run INIT, then START.
   2. Compare the final pose in telemetry with the park pose: x 36, y 24 inches.
   3. Check the loop time the app shows. If it is well above the simulator's, reduce telemetry and camera work first.
7. **Live data.**
   1. With the laptop on robot Wi-Fi, confirm the app shows the robot's pose moving during Example Auto.
   2. Confirm the app's Stop button stops the OpMode.

   The app cannot start OpModes or send gamepad input to a real robot.
8. **Example TeleOp.**
   1. Check that driving starts field-centric and that **A** switches to robot-centric.
   2. Check that **back** resets the heading.
   3. Check that **right bumper** slows the robot.

## Record the results

Note the date, robot, SDK and library versions (shown in the app's Robot view), and anything that differed
from the simulator. Differences in steps 3 to 6 usually mean `Constants.java` still needs tuning, not that
the generated code is wrong.
