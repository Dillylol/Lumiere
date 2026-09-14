# Stream protocol (version 1)

The robot library and the desktop simulator send live data to the app over the same WebSocket
protocol. An app can therefore show a real robot and a simulated robot with the same code.

| Source | Address | Authentication |
| --- | --- | --- |
| Robot Controller | `ws://192.168.43.1:58080/stream` (Control Hub), `ws://192.168.49.1:58080/stream` (phone) | None. The server is read-only apart from `stop`. |
| Desktop simulator | `ws://127.0.0.1:<port>/stream`, bound to loopback only | Token. The first message must be `auth`. |

- **Format.** Every frame is a UTF-8 JSON object with a string `type`.
- **Units and coordinates.** Pedro Pathing field coordinates: inches, origin at the bottom-left corner of the field, heading in radians with 0 along +x and counterclockwise positive.
- **Origin check.** Browser connections are accepted only from the desktop app (`tauri://localhost`, `http://tauri.localhost`) and local development servers (`http://localhost:<port>`, `http://127.0.0.1:<port>`). Connections without an `Origin` header are accepted.
- **Idle clients.** Clients must send `ping` at least every 10 seconds or they are disconnected.

## Client to server

| Type | Fields | Accepted by | Effect |
| --- | --- | --- | --- |
| `auth` | `token` | Simulator | Must be the first message. A wrong or missing token closes the connection. Unauthenticated clients are closed after 3 seconds. |
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
  "library": "1.0.0"
}
```

The simulator also sends:

- `drivetrain`: `{ "motors": [fl, fr, bl, br], "localizer": "pinpoint" | null, "source": "<constants class or FTC SDK sample names>" }`
- `robot`: `{ "widthInches": 18, "lengthInches": 18 }`

### `manifest`

Configured hardware and the OpModes a Driver Station would list. It is sent after `hello`, and again
whenever an OpMode is initialized on the robot.

```json
{
  "type": "manifest",
  "devices": [{ "name": "left_front_drive", "type": "motor" }],
  "opModes": [{ "name": "Example Auto", "group": "Examples", "flavor": "autonomous" }]
}
```

- **Device `type` values:** `motor`, `servo`, `crservo`, `imu`, `voltage`, `digital`, `touch`, `color`, `distance`, `analog`, `pinpoint`, `otos`, `camera`, or a lowercase class name for other devices.
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
- **Device `type` values:** `motor`, `servo`, `crservo`, `imu`, `digital`, `touch`, and `distance`.

`scripts/sim-smoke.mjs` is a working reference client.
