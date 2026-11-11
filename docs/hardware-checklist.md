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
| Device readings in Robot mode | On a hub they come from the SDK's hub drivers, which the simulator and virtual hub replace | 7 |
| Deploying with adb over Wi-Fi | Needs a Control Hub | 2 |
| Lumière Live's stops over real robot Wi-Fi | The virtual hub's network never drops: the app and robot share one computer | 9 |

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
   3. Confirm the Driver Station lists **Example Auto** and **Example TeleOp**. Projects the app creates include them. The [Lumière Quickstart](https://github.com/Dillylol/Lumiere-Quickstart) repository doesn't: build a short autonomous in Lumière for step 6, and skip step 8.
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
7. **Live data.** With the laptop on robot Wi-Fi, open Pathing → Robot.
   1. Confirm the app shows the robot's pose moving during Example Auto.
   2. Confirm the app's Stop button stops the OpMode.
   3. **Your own OpModes** (robot library 0.4.0 or newer). Run an OpMode of your own that drives with a Pedro Pathing follower but doesn't use Lumière's `Session`. Robot mode shows its pose, and the Data panel graphs each motor's power and servo's position.
   4. **Device readings.** Run code that sets known values, and compare them with the Mechanisms and Data panels. Each must read what the code set, with the same sign. Cover what the robot has of these:
      - a motor set to reverse
      - a goBILDA motor (the SDK turns these the other way internally)
      - a motor driving to an encoder target (its power reads positive)
      - a continuous servo set to reverse
      - a servo with a narrowed range (`scaleRange`), set to reverse
   5. **Loop time.** Compare the loop time with the app connected and disconnected. It should not change: the robot library reads the SDK's records of what it last sent, and never asks the hub.

   The app cannot start OpModes or send gamepad input to a real robot.
8. **Example TeleOp.**
   1. Check that driving starts field-centric and that **A** switches to robot-centric.
   2. Check that **back** resets the heading.
   3. Check that **right bumper** slows the robot.
9. **[Lumière Live](live.md)** (optional; robot library 0.4.0 or newer). On the Robot page, turn on Live runs, and in the hardware list set a power limit of 0.3 on every motor and continuous servo the program uses. Deploy and install, then confirm the Driver Station lists **Lumière Live**.
   1. **Check.** With Pathing → Robot connected, INIT Lumière Live.
      - The panel and the Driver Station show the program as passed.
      - On the Robot page, use **Add a device the robot hasn't reported**, and set it with a Motor or Servo action. The app sends the program again, and the robot rejects it, naming the device.
      - Remove the action and the device.
   2. **Run** (robot on the stand). START.
      - No motor or continuous servo runs above its 0.3 limit, and the wheels turn as the paths command.
      - The Mechanisms panel shows each mechanism's state, matching the plan's.
      - Include a Motor action and a timed action, such as an intake "In for 2 s": each runs, and the timed one stops on time.
   3. **Silence.** During a run, turn off the laptop's Wi-Fi. The robot stops within about a second, the OpMode ends, and the Driver Station shows why.
   4. **Disconnect.** During a run, disconnect in Pathing → Robot. The robot stops at once.
   5. **Driver Station STOP.** During a run, press STOP. The robot stops at once.
   6. **Travel.** Give a motor that takes encoder targets a travel range narrower than its targets: the check rejects it. Then drive it past a narrow range with a power state: the run stops, naming the motor.
   7. **On the floor.** Raise the power limits as far as you trust the program, place the robot at the start pose, and run the full autonomous. Compare its time with the deployed OpMode's in the Run comparison.
   8. **Before events,** turn Live runs off and deploy, then confirm the Driver Station no longer lists Lumière Live.

## Record the results

Note the date, robot, SDK and library versions (shown in the app's Robot view), and anything that differed
from the simulator. Differences in steps 3 to 6 usually mean `Constants.java` still needs tuning, not that
the generated code is wrong.
