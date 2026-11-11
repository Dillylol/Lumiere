# Stream protocol (version 1)

The robot library and the desktop simulator send live data to the app over the same WebSocket
protocol. An app can therefore show a real robot and a simulated robot with the same code.

| Source | Address | Authentication |
| --- | --- | --- |
| Robot Controller | `ws://192.168.43.1:58080/stream` (Control Hub), `ws://192.168.49.1:58080/stream` (phone) | None. The server is read-only apart from `stop` and, while the Driver Station has Lumière Live initialized, pairing with it and sending it a program to check. |
| Desktop simulator | `ws://127.0.0.1:<port>/stream`, bound to loopback only | Token. The first message must be `auth`. |

- **Format.** Every frame is a UTF-8 JSON object with a string `type`.
- **Units and coordinates.** Pedro Pathing field coordinates: inches, origin at the bottom-left corner of the field, heading in radians with 0 along +x and counterclockwise positive.
- **Origin check.** Browser connections are accepted only from the desktop app (`tauri://localhost`, `http://tauri.localhost`) and local development servers (`http://localhost:<port>`, `http://127.0.0.1:<port>`). Connections without an `Origin` header are accepted.
- **Idle clients.** Clients must send `ping` at least every 10 seconds or they are disconnected.

## Client to server

| Type | Fields | Accepted by | Effect |
| --- | --- | --- | --- |
| `auth` | `token` | Both | Simulator: must be the first message. A wrong or missing token closes the connection, and unauthenticated clients are closed after 3 seconds. Robot: pairs this connection with Lumière Live, using the computer's pairing secret, while the Driver Station has Lumière Live initialized. A wrong secret gets an `error`, and the fifth wrong secret closes the connection. |
| `program` | `program` | Robot | Sends Lumière Live a program to check and, when the Driver Station presses START, run. Requires a paired connection, and Lumière Live initialized but not started. See [Lumière Live programs](#lumière-live-programs). |
| `ping` | `t` (any) | Both | Replies with `pong` echoing `t`. |
| `stop` | none | Both | Robot: requests a stop of the active OpMode, like the Driver Station STOP button. Simulator: presses STOP. |
| `init` | `opMode` (name) | Simulator | Stops any running OpMode, then initializes the named OpMode. |
| `start` | none | Simulator | Presses START. Fails unless an OpMode is initialized. |
| `gamepad` | `index` (1 or 2), `state` | Simulator | Replaces the gamepad state. See [Gamepad state](#gamepad-state). |
| `place` | `x`, `y`, `heading` | Simulator | Moves the robot. Fails while an OpMode is initialized or running. |
| `shutdown` | none | Simulator | Stops the simulator process. |

A command that fails produces an `error` message.

## Server to client

### `hello`

Sent once after connecting, or after `auth` on the simulator.

```json
{
  "type": "hello",
  "protocol": 1,
  "source": "robot",
  "library": "1.0.0",
  "capabilities": { "live": 1 }
}
```

- **`capabilities`** (robot only): what the robot library can do beyond the stream. `live` is the [Lumière Live](#lumière-live-programs) program format it reads. Robot libraries older than Lumière Live leave it out.

The simulator also sends:

- `drivetrain`: `{ "motors": [fl, fr, bl, br], "localizer": "pinpoint" | null, "source": "<constants class or FTC SDK sample names>", "pose": "pedro", "kinematics": { … } }`
  - `localizer`: the Pinpoint's device name, or null for any other localizer.
  - `pose`: `"pedro"` means followers read the simulated pose through Pedro Pathing, whatever localizer
    the robot uses.
  - `kinematics`: the measurements from `ForesightConfig` that the simulated drivetrain uses, when
    the constants set them: `forwardVelocity` and `strafeVelocity` in inches per second, and
    `forwardDeceleration` and `strafeDeceleration` in inches per second squared.
- `robot`: `{ "widthInches": 18, "lengthInches": 18 }`

### `manifest`

Configured hardware and the OpModes a Driver Station would list. It is sent after `hello` and
whenever an OpMode is initialized on the robot.

The robot also sends it when it finishes starting and after every stop, without a `lifecycle`
message. At those points the FTC SDK initializes its own default OpMode. The stream starts before the
Robot Controller has registered OpModes and built the hardware map, so an app that connects during
startup first receives an incomplete manifest, then the complete one.

```json
{
  "type": "manifest",
  "devices": [{ "name": "left_front_drive", "type": "motor" }],
  "opModes": [{ "name": "Example Auto", "group": "Examples", "flavor": "autonomous" }],
  "pedro": {
    "constants": "org.firstinspires.ftc.teamcode.pedro.Constants",
    "localizer": "threewheelimu",
    "devices": [{ "name": "left_front_drive", "role": "frontLeft" }, { "name": "left_front_drive", "role": "leftEncoder" }, { "name": "imu", "role": "imu" }]
  }
}
```

- **Device `type` values:** `motor`, `servo`, `crservo`, `imu`, `voltage`, `digital`, `touch`, `color`, `distance`, `analog`, `pinpoint`, `otos`, `octoquad`, `camera`, or a lowercase class name for other devices. A device that implements `Manifest.Typed` states its own type.
- **Names:** every configured name is listed, including names that differ only in case.
- **`pedro`:** the devices Pedro Pathing drives, read from the team's Pedro constants class. It is left out when no constants class is found.
  - **Where the robot looks:** `org.firstinspires.ftc.teamcode.pedro.Constants` (Lumière's quickstart), then `org.firstinspires.ftc.teamcode.pedroPathing.Constants` (Pedro Pathing's quickstart). The simulator reads the class the app names in its configuration. A class that holds no Pedro Pathing configs is never initialized.
  - **`role`:** Pedro's own setting name without "Name": `frontLeft` from `MecanumConfig.frontLeftName`, `leftEncoder` from `ThreeWheelConfig.leftEncoderName`, `xPod` from `TwoWheelConfig.xPodName`. A localizer set up with one device (`PinpointConfig.name`, `OTOSConfig.name`, `OctoQuadConfig.name`) gives that device the localizer's kind as its role. Settings that are not set are left out.
  - **`localizer`:** the localizer config's type in lower case without "Config", such as `pinpoint` or `threewheelimu`, or null.
- **`flavor` values:** `autonomous`, `teleop`, or `utility`.
- **Simulator devices:** the simulator lists only devices it has already created, so the list grows as OpModes request hardware.

### `lifecycle`

```json
{ "type": "lifecycle", "opMode": "Example Auto", "phase": "init" }
```

- **`phase` values:** `init`, `running`, and `stopped`. The simulator also uses `idle` before the first OpMode.
- **Late connections:** the most recent lifecycle message is replayed to clients that connect later.

### `state`

Sent by `Session.update()` in an OpMode, at most 20 times per second and only while a client is
connected.

```json
{
  "type": "state",
  "opMode": "Example Auto",
  "loopMs": 12.4,
  "pose": { "x": 36.0, "y": 84.0, "heading": 0.785 },
  "follower": "follow",
  "target": { "x": 36.1, "y": 84.2, "heading": 0.785 },
  "data": { "intake": "running" }
}
```

- **Optional fields:** `pose`, `follower`, and `target` are present only when the session has a follower. `target` is present only while following a path.
- **`follower` values:** `follow`, `hold`, `manual`, or `idle`.
- **`data`:** holds values added with `Session.data(name, value)` since the previous report.
- **OpModes without a session (robot library 0.4.0 and later, on a robot):** while any other OpMode is initialized or running, the robot library finds its Pedro Pathing follower, in the OpMode's fields and the team's objects they hold, and sends about ten `state` messages a second with only `opMode` and `pose`. It sends none while a session is reporting, or when it finds no follower.

```json
{ "type": "state", "opMode": "Bjorn Red Goal Auto", "pose": { "x": 36.0, "y": 84.0, "heading": 0.785 } }
```

### `devices` (robot only)

Sent by robot library 0.4.0 and later about ten times a second while any OpMode is initialized or
running, and only while a client is connected. Each configured motor and continuous servo has its
power, and each servo its position, as the SDK last sent them, by configured name.

```json
{
  "type": "devices",
  "opMode": "Bjorn Red Goal Auto",
  "devices": {
    "intake": { "type": "motor", "power": 0.7 },
    "spinner": { "type": "crservo", "power": -0.5 },
    "kicker": { "type": "servo", "position": 0.4 }
  }
}
```

- **Read from the SDK's record, never from the hub:** reading happens on the library's own thread, so it must not slow the OpMode. On a hub, a device the SDK has no record for yet (one the OpMode hasn't set) is left out.
- **No encoder positions:** reading them would ask the hub. The simulator's `robot` message has them.

### `path`

Sent when the follower starts a new path. The path is sampled at 65 evenly spaced parameter values.

```json
{ "type": "path", "points": [[9.0, 72.0], [9.4, 72.2]] }
```

### `robot` (simulator only)

The simulated robot's true state, about 30 times per second.

```json
{
  "type": "robot",
  "opMode": "Example Auto",
  "phase": "running",
  "elapsed": 4.21,
  "pose": { "x": 36.0, "y": 84.0, "heading": 0.785 },
  "velocity": { "x": 12.1, "y": 3.4, "heading": 0.2 },
  "voltage": 12.6,
  "devices": {
    "claw": { "type": "servo", "position": 0.5 },
    "arm": { "type": "motor", "power": 0.8, "position": 412 }
  }
}
```

- **Velocity:** field frame, in inches per second; `heading` is in radians per second.
- **Unset servos:** a servo that has not been commanded has `position: null`.
- **`localizer`:** once the OpMode has a Pedro Pathing follower, the class name of the localizer the
  simulation stands in for, such as `ThreeWheelIMULocalizer`.

### `telemetry` (simulator only)

Driver Station telemetry lines, sent when they change.

```json
{ "type": "telemetry", "lines": ["x (in): 36.0", "follower: HOLD"] }
```

### `error`

```json
{
  "type": "error",
  "opMode": "Example Auto",
  "message": "IllegalStateException: intake jammed",
  "stack": [{ "class": "org.firstinspires.ftc.teamcode.Auto", "method": "loop", "file": "Auto.java", "line": 42 }]
}
```

The simulator sends at most 30 stack frames. Command errors contain only `message`.

### `pong`

```json
{ "type": "pong", "t": 1726000000000 }
```

### `live` (robot only)

Lumière Live's report, sent to every client whenever it changes while Lumière Live is initialized or running. The latest one is replayed to clients that connect later.

```json
{
  "type": "live",
  "opMode": "Lumière Live",
  "state": "accepted",
  "started": true,
  "paired": true,
  "dryRun": false,
  "powerCap": 0.6,
  "silenceMs": 1000,
  "program": { "name": "Red Goal", "revision": "3f2a9c1b", "steps": 18, "paths": 9, "mechanisms": 4 },
  "problems": [],
  "notes": ["\"Intake\" in Intake is given power 1 in \"In\"; its power limit cuts that to 0.7."],
  "run": { "phase": "stopped", "reason": "Lumière Live stopped: the paired computer was silent for more than 1.0 s." }
}
```

- **`state`:** `waiting` for a program, `checking` one, `accepted`, `rejected`, or `closed` once the OpMode stops.
- **`paired`:** whether a computer is paired with this run of Lumière Live.
- **`dryRun`:** true from robot libraries whose Lumière Live only checked programs and never moved. It is false since programs run.
- **`powerCap`:** the power limit of every device in a format 1 program. Format 2 programs carry each device's own limit, so Lumière 0.4.0 and later ignore it.
- **`silenceMs`:** how long Lumière Live waits to hear from the paired computer before it stops a run.
- **`run`:** after START. `phase` is `running`, `finished` (the routine is done, and the follower holds its last pose), `stopped` with a `reason`, or `not run` with a `reason`, such as no program that passed or no paired computer. `elapsedMs` is the routine's time once it finishes. The `closed` report keeps the run's last phase, so it says how the run ended; Driver Station STOP during a run makes it `stopped`. The app shows that report until the next INIT.
- **`problems`:** why the program can't run on this robot: a device that is missing or configured as another type, a device Pedro Pathing drives, an encoder target on a dead wheel's port, an encoder target without a travel range or outside it, or a malformed program. **`notes`:** what doesn't stop it, such as a power its device's limit cuts.

## Lumière Live programs

Lumière generates `LumiereLive.java` (`@Autonomous` "Lumière Live") when Live runs are on for a computer. It extends the robot library's `LiveRunner` and carries the SHA-256 of that computer's pairing secret and the team's Pedro constants class.

- **INIT:** a program that passes the check is set up as a generated OpMode's `init()` sets it up. The follower is placed at the start pose, each mechanism's devices are configured and its starting state applied, and the devices the routine sets directly are configured.
- **START:** the routine runs with the Pedro Pathing paths and Ivy commands the generated Java would use, with every power cut to its device's limit, as the generated Java cuts it.
- **Stopping:** a run stops when the paired computer is silent for more than `silenceMs` (the app pings every 250 ms while paired, and on a received message whenever its timer runs late, as browsers make it for a hidden page), when it disconnects, when a motor with encoder targets leaves its travel range, or on any error. Stopping sets the program's motors and continuous servos to zero, leaves servos where they are, stops the follower, and ends the OpMode.
- **The Driver Station stays in charge:** only it can INIT and START Lumière Live, and its STOP always works.

When Lumière Live is initialized, the paired app sends `auth`, then `program`, and a new `program` whenever the open program changes before START. A program (format 2, from Lumière 0.4.0):

```json
{
  "format": 2,
  "name": "Red Goal",
  "revision": "3f2a9c1b",
  "start": { "x": 110.5, "y": 135.5, "headingDeg": 0 },
  "devices": [
    { "name": "Intake", "kind": "motor", "reversed": true, "powerLimit": 0.7 },
    { "name": "lift", "kind": "motor", "reversed": false, "travel": { "minTicks": -100, "maxTicks": 1500 } },
    { "name": "kicker", "kind": "servo", "reversed": false }
  ],
  "mechanisms": [{
    "id": "intake", "name": "Intake", "initialState": "off",
    "devices": [{ "id": "m", "name": "Intake", "kind": "motor" }],
    "states": [{ "id": "off", "name": "Off", "outputs": { "m": { "kind": "power", "value": 0 } } },
               { "id": "in", "name": "In", "outputs": { "m": { "kind": "power", "value": 1 } } }]
  }],
  "paths": [{
    "id": "p1", "name": "Start to Shoot", "kind": "atomic", "heading": null,
    "segments": [{ "start": { "x": 110.5, "y": 135.5, "headingDeg": 0 }, "controls": [], "end": { "x": 96, "y": 96, "headingDeg": 45 },
      "heading": { "type": "linear", "startDeg": 0, "endDeg": 45 } }]
  }],
  "routine": [
    { "kind": "together", "steps": [
      { "kind": "path", "path": "p1" },
      { "kind": "state", "mechanism": "intake", "state": "in", "duration": { "ms": 2000, "then": "off" } }
    ] },
    { "kind": "device", "device": "lift", "output": { "kind": "target", "ticks": 1200, "power": 0.8 } },
    { "kind": "device", "device": "kicker", "output": { "kind": "position", "value": 0.6 }, "duration": { "ms": 500, "thenPosition": 0.2 } },
    { "kind": "wait", "ms": 1200 }
  ]
}
```

- **Same numbers as the generated Java:** angles are in degrees, and every number is rounded to 6 decimal places as the Java generator writes it. Each path carries the start, control and end poses the generated OpMode declares, so Lumière Live gets the same doubles a deployed OpMode parses.
- **Paths:** an `atomic` path has one segment with its own `heading` rule. A `compound` path has several segments; its `heading` applies across them all, or is null when each segment has its own. Heading rules are those of the project format: `linear`, `constant`, `tangential` (`reverse`), and `piecewise` (`segments` of rules between `startProgress` and `endProgress`, including `facingPoint`).
- **Devices:** every device the program drives, once, by configured name: `motor`, `servo` or `crservo`, whether it is `reversed`, its `powerLimit` (motors and continuous servos; above 0 and at most 1, left out when it is 1), and a motor's `travel`. Each power is sent as the project has it and cut to the limit on the robot. A motor that takes encoder targets needs a `travel` range in ticks from where it was at INIT; targets must fall within it, and the run stops if the motor goes more than 5% of the range (at least 20 ticks) past it.
- **Mechanisms:** the ones the routine uses, plus any with a starting state. Their devices name devices from `devices`, as the kind the list gives them. Outputs are `power` (-1 to 1), `position` (0 to 1, servos only) or `target` (whole `ticks` at a `power` above 0, motors only).
- **Routine:** `path`, `wait` (`ms`, 0 to 10 minutes), `state`, `device` (a device's `output`), and `together` or `race` groups of `steps`, nested at most 8 deep. Empty groups are left out, as the generated Java leaves them out.
  - **Timed steps:** a `state` or `device` step with a `duration` holds for `ms` (above 0, at most 10 minutes), then sets the mechanism to `then`, stops a motor or continuous servo, or moves a servo to `thenPosition` (0 when absent). What comes after also happens when a race ends the step early.
  - **Encoder targets without a duration** finish when the motor reaches its target, as a mechanism state's targets do.
- **Limits:** at most 100 devices, 30 mechanisms, 200 paths and 1,000 steps. A format newer than the robot library reads is refused with a request to update it.
- **Format 1** (Lumière 0.3.x) kept each device's direction and travel in its mechanism, and had no `devices`, `device` steps or durations. The robot library still reads it, giving every device the `powerCap()` limit of the generated `LumiereLive.java` (0.6 unless set).

## Gamepad state

Field names and ranges match the FTC SDK's `Gamepad` class.

- **Missing fields:** a missing field is released or centered.
- **Sticks:** `left_stick_x`, `left_stick_y`, `right_stick_x`, `right_stick_y` range from -1 to 1. Up and left are negative, as the SDK reports them.
- **Triggers:** `left_trigger` and `right_trigger` range from 0 to 1.
- **Buttons** (booleans): `dpad_up`, `dpad_down`, `dpad_left`, `dpad_right`, `a`, `b`, `x`, `y`, `guide`, `start`, `back`, `left_bumper`, `right_bumper`, `left_stick_button`, `right_stick_button`, and `touchpad`.
- **PlayStation names:** `cross`, `circle`, `square`, `triangle`, `share`, `options`, and `ps` mirror the Xbox-style buttons.

## Launching the simulator

The simulator runs inside a robot project's unit-test task, so it uses the project's compiled code
and dependencies:

```bash
./gradlew :TeamCode:testDebugUnitTest --tests org.firstinspires.ftc.teamcode.simulation.RunSimulator -Psim.port=<port> [-Psim.config=<file>]
```

- **Token:** the launcher passes it in the `SIM_TOKEN` environment variable, at least 16 characters. It is not passed on the command line, where it would appear in process listings.
- **Ready line:** the simulator prints `SIMULATOR_READY <port>` to standard output once it accepts connections.
- **Exit:** it exits after `shutdown`, or after 60 seconds with no connected client.

The optional configuration file:

```json
{
  "start": { "x": 72, "y": 72, "headingDegrees": 90 },
  "robot": { "widthInches": 18, "lengthInches": 18, "trackWidthInches": 14.5, "wheelBaseInches": 12.5, "wheelDiameterInches": 4.09, "motorFreeRpm": 312, "batteryVolts": 12.8 },
  "devices": [{ "name": "arm", "type": "motor" }, { "name": "claw", "type": "servo" }],
  "package": "org.firstinspires.ftc.teamcode",
  "constantsClass": "org.firstinspires.ftc.teamcode.pedro.Constants"
}
```

- **`devices`:** declares hardware that code reads through typed mappings such as `hardwareMap.dcMotor.get(name)`. Devices requested with `hardwareMap.get(Class, name)` are created automatically.
- **Device `type` values:** `motor`, `servo`, `crservo`, `imu`, `digital`, `touch`, and `distance` are simulated. Any other short lowercase type, such as `analog`, `camera`, or a team driver's class name, is listed in the manifest but not simulated: OpModes that ask for it get nothing, as before.

`scripts/sim-smoke.mjs` is a working reference client.
