# FTC robot project

This project is the official **FTC SDK {{FTC_SDK_TAG}}** Robot Controller with these libraries added:

- **[Pedro Pathing](https://pedropathing.com/docs/pathing) {{PEDRO_VERSION}}** (path following) with AutoTune
- **[Ivy](https://pedropathing.com/docs/ivy) {{IVY_VERSION}}** (commands)
- **[Panels](https://panels.bylazar.com) {{PANELS_VERSION}}** (dashboard)

It was created with {{APP_NAME}}. You can keep using {{APP_NAME}} or work in Android Studio: the project builds the same way in both.
The original FTC SDK readme is in [`doc/FTC_SDK_README.md`](doc/FTC_SDK_README.md).

## Requirements

- Android Studio Narwhal 3 Feature Drop or newer, or {{APP_NAME}}'s built-in build tools
- A REV Control Hub, or an Android phone set up as a Robot Controller

## Project layout

| Path | Contents |
| --- | --- |
| `TeamCode/src/main/java/org/firstinspires/ftc/teamcode/pedro/Constants.java` | Drivetrain, localizer, and path-follower settings |
| `TeamCode/src/main/java/org/firstinspires/ftc/teamcode/pedro/Tuning.java` | Registers the AutoTune procedures |
| `TeamCode/src/main/java/org/firstinspires/ftc/teamcode/pedro/procedures/` | Pedro Pathing's AutoTune procedures (BSD-3-Clause-Clear, see `licenses/`) |
| `TeamCode/src/main/java/org/firstinspires/ftc/teamcode/examples/` | Example autonomous and TeleOp |
| `TeamCode/libraries.gradle` | Library versions and repositories |

## First-time setup

1. **Configure hardware.** On the Driver Station, create a configuration with:
   - four drive motors named `left_front_drive`, `right_front_drive`, `left_back_drive`, `right_back_drive`
   - a goBILDA Pinpoint named `pinpoint`

   These names match the FTC SDK samples. If you use different names, change them in `Constants.java`.
2. **Deploy.** Build and install the app on the Robot Controller.
3. **Tune.** Connect a laptop to the robot's Wi-Fi, open <http://192.168.43.1:10158>, and run the
   AutoTune procedures in order:
   1. **Mecanum**: motor names and directions
   2. **Pinpoint**: odometry pod directions and offsets
   3. **Foresight**: path-following constants. The robot drives on its own, so clear a full field tile around it first.
   4. **Tests**: line, curve, and hold checks

   After each procedure, paste the generated code into `Constants.java`. Once all three configs are tuned, set `TUNED = true`.
4. **Test at low speed.** Run **Example Auto** with the robot on the field, and be ready to press STOP.

Until tuning is done, the example OpModes show a warning in telemetry. The starting constants come
from the simulator and are only estimates.

## Dashboards

| Dashboard | Address (robot Wi-Fi) |
| --- | --- |
| Panels telemetry, field, and configurables | <http://192.168.43.1:8001> |
| Pedro Pathing AutoTune | <http://192.168.43.1:10158> |

On a phone Robot Controller, use `192.168.49.1` instead of `192.168.43.1`.

## Coordinates

Pedro Pathing measures position in inches from the bottom-left corner of the field (0 to 144 on both
axes). Heading 0 points along +x, and angles increase counterclockwise. See
[Pedro Pathing coordinates](https://pedropathing.com/docs/pathing/reference/coordinates).

## Updating

- **FTC SDK:** follow the official instructions. This project does not change `build.common.gradle` or
  `build.dependencies.gradle`, so those files can be replaced directly.
- **Libraries:** change the versions in `TeamCode/libraries.gradle`, rebuild, and re-run the Tests procedure.

## Help

- FTC documentation: <https://ftc-docs.firstinspires.org>
- Pedro Pathing documentation: <https://pedropathing.com/docs/pathing>
- Panels documentation: <https://panels.bylazar.com>
