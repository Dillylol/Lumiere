# Desktop simulator

The desktop simulator runs a team's real, compiled OpModes on the desktop JVM. It uses the official
FTC SDK classes, the real Pedro Pathing follower, Ivy, and Panels, with simulated hardware and a
mecanum physics model in place of the robot.

The web app cannot run Java. It shows a kinematic preview instead, and labels it as a preview.

## How it runs

The simulator is launched through Gradle's local unit-test task in the robot project. That task
already provides the compiled TeamCode classes, every dependency, and Android's unit-test stub
library, so no extra runtime is installed.

| Piece | Role |
| --- | --- |
| Official FTC SDK 12.0 classes | `OpMode`, `LinearOpMode`, `HardwareMap`, `Gamepad`, telemetry, and hardware interfaces run unchanged |
| Lifecycle driver | Makes the same package-private lifecycle calls as `OpModeManagerImpl`: init, start, event-loop iterations, and stop |
| Simulated hardware | Motors, servos, sensors, and the goBILDA Pinpoint, registered in the hardware map under the team's configured names |
| Physics | A mecanum drivetrain model stepped at 1 kHz on wall-clock time |
| Stream | The same WebSocket protocol the robot uses, so the app shows simulated and real runs the same way |

Simulation runs in real time. Pedro Pathing and Ivy read the system clock, so time is not
accelerated.

## Spike results (2026-09-13)

A generated quickstart project (FTC SDK 12.0.0, Pedro Pathing 3.0.0, AutoTune 1.0.0, Ivy 1.1.1,
Panels 1.0.12) was used for both gates.

### G1: dependencies compile and dex together

`:TeamCode:assembleDebug` succeeds, producing a debug APK. The build compiles the quickstart
`Constants`, `Tuning`, examples, and Pedro's pinned AutoTune procedures. All Kotlin standard
library artifacts resolve to 2.4.10, and there is a single `nanohttpd-websocket` 2.3.1.

Panels 1.0.12 depends on Material Components, which requires compileSdk 34, but the FTC SDK
compiles against API 30. The quickstart raises `compileSdkVersion` to 34 in
`TeamCode/libraries.gradle`, which TeamCode applies. The FTC-owned `build.common.gradle` and
`build.dependencies.gradle` files are not edited. `minSdk` and `targetSdk` are unchanged.

### G2: official classes on the desktop JVM

| Check | Result |
| --- | --- |
| Iterative `OpMode` lifecycle through the official `OpMode.internalRunOpMode` | Pass |
| `LinearOpMode`: `waitForStart`, `opModeIsActive`, `sleep`, thread shutdown on stop | Pass |
| Telemetry captured through the SDK's `TelemetryImpl` | Pass |
| Ivy `waitMs` and command scheduling | Pass |
| Real `Follower(PinpointLocalizer, Mecanum, Foresight)` follows a 48-inch line | Pass: ends at (72.00, 72.00), heading 0.00° |
| Unmodified `ExampleAuto` (Ivy, Panels telemetry and field drawing, lines and a curve) | Pass: parks at (36.00, 24.00), heading 225° |

Three small adaptations were needed. None of them replaces an SDK class.

1. **Executor.** The SDK's `ThreadPool` records thread ids through Android APIs that the desktop
   stub library does not implement. The lifecycle driver mirrors `OpModeInternal.internalInit`
   using a standard Java executor.
2. **`HardwareMap.tryGet`.** The SDK checks whether it is running on a REV Control Hub, which loads
   the SDK's native library. The simulator's `HardwareMap` subclass overrides only `tryGet` to skip
   that check.
3. **Pinpoint and Panels.**
   - The simulated Pinpoint overrides the driver's protected `doInitialize`, which would otherwise
     talk to a real I2C bus.
   - Panels normally creates its socket from an app start hook. The simulator installs an unstarted
     socket, so Panels calls are accepted and nothing is sent.

The "SDK shim" fallback was not needed.

## Limits

- **Time:** simulated time is real time; runs cannot be sped up or single-stepped.
- **Physics:** the model is an estimate. Traction, battery sag, and collisions are approximations, so
  a path that works in simulation still needs a low-power test on the robot.
- **Hardware not simulated:** cameras and vision processors (for example the Limelight and AprilTag
  pipelines) return no detections.
- **Hardware map:** devices requested through `hardwareMap.get(Class, name)` are created on demand.
  Devices read from typed mappings such as `hardwareMap.dcMotor.get(name)` must be declared in the
  simulator configuration or in the drivetrain constants.
