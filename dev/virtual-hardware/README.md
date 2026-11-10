# Virtual hardware (development only)

A virtual REV Control Hub for testing Lumière's robot side without a robot. Nothing in `dev/` ships:
it is not part of the app, the robot library, the quickstart overlay, or any release, and it never
edits them. The harness drives the shipped code as it is.

Results from the first runs are in [FINDINGS.md](FINDINGS.md).

## What it runs

| Layer | What runs | Shipped code? |
| --- | --- | --- |
| OpModes | The robot project's own OpModes (Example Auto, Example TeleOp, or a team's) | Team code, unchanged |
| Robot library | `RobotHooks` boots the stream server on port 58080 on every interface, as on a hub. `Session`, `Manifest`, and `StreamServer` report to apps | Yes, unmodified |
| Robot | Simulated hardware, mecanum physics, and the OpMode lifecycle from the `sim` module | Yes, unmodified |
| Hub platform | Event loop, OpMode manager, and OpMode registry: stand-ins, listed below | No, harness only |
| Driver Station | A token-protected WebSocket on 127.0.0.1 and the console in `virtual-hub.mjs` | No, harness only |

Startup follows the Robot Controller (`FtcRobotControllerActivity.requestRobotSetup` and
`FtcEventLoop.init` in SDK 12.0). The harness first calls the robot library's `@OnCreateEventLoop`
hook (`RobotHooks.onCreateEventLoop`), which starts the stream before any OpModes are registered.
Then it registers OpModes, builds the hardware map, and initializes and starts the SDK's default
OpMode. The `restart` command repeats this sequence in the same process, as **Restart Robot** does
on a hub. Apps connect to
`ws://127.0.0.1:58080/stream` with no token, as they would to a hub at 192.168.43.1. They see only
what the robot library sends, and STOP is the only command that does anything. The Driver Station
channel is never installed into the robot library's `Stream`, so its telemetry and true-pose
messages cannot leak onto the robot stream.

### Stand-ins for the hub's platform

| SDK class | Why it cannot run on a desktop JVM | Stand-in |
| --- | --- | --- |
| `FtcEventLoop` | Its constructor needs the Robot Controller app | `VirtualEventLoop`, created without its constructor; it only answers `getOpModeManager()` |
| `OpModeManagerImpl` | It runs OpModes on the hub's event loop | `VirtualOpModeManager`. It notifies listeners in the order the SDK 12.0 manager does, checked against its bytecode: post-stop while the stopping OpMode is still active, then the default `$Stop$Robot$` OpMode is initialized and started |
| `RegisteredOpModes` | On a hub, the SDK fills it by scanning the APK. Its class initializer loads the hub's native library and Android string resources | A class with the same name in `harness/java`, which wins on the test class path. It holds real `OpModeMeta` objects built with the SDK's own builder, including the system OpMode the robot library must filter out |

### How it is injected

`virtual-hub.mjs` runs the robot project's unit-test task with
`--init-script virtual-hub.init.gradle`. For that run only, the init script adds `harness/java` to
TeamCode's unit tests and passes settings to the test JVM through environment variables. No file in
the robot project is written. With `--pedro <version>`, the init script also resolves Pedro Pathing
`core` and `revhub` at that version, for the robot project only. A local robot-library build keeps
its own Pedro version, as a published library would.

## Usage

The first run creates `work/robot-project` (ignored by git) from the quickstart, using this
checkout's robot library:

```bash
node dev/virtual-hardware/virtual-hub.mjs --create
```

Driver Station console (`list`, `init <name|number>`, `start`, `stop`, `drive <fwd> <strafe> <turn>`,
`pad a=true ...`, `place <x> <y> <deg>`, `status`, `telemetry`, `quit`):

```bash
node dev/virtual-hardware/virtual-hub.mjs
```

Robot-stream contract checks:

```bash
node dev/virtual-hardware/virtual-hub.mjs --check
```

Shakedown: TeleOp driving, OpModes that fail on purpose, awkward data, two apps, and a robot restart.

```bash
node dev/virtual-hardware/virtual-hub.mjs --shakedown
```

Run one OpMode, or a scripted scenario (`wait <s>`, `until app`, `until <phase>`, and any console command):

```bash
node dev/virtual-hardware/virtual-hub.mjs --run "Example Auto" --seconds 12
```

```bash
node dev/virtual-hardware/virtual-hub.mjs --script "until app; init Example Auto; start; until stopped"
```

Heading probe under another Pedro Pathing version:

```bash
node dev/virtual-hardware/virtual-hub.mjs --probe --pedro 3.0.2
```

Other options: `--project <dir>` (another robot project), `--config <simulator.json>` (start pose,
robot size, extra devices; the same format as the desktop simulator's), and `--offline`.

### Connecting Lumière to it

In the Robot tab, set **Control Hub address** to `127.0.0.1` and choose **Connect robot**. This
works from the web dev server and from the desktop app. Then start OpModes from the console, as a
team would from the Driver Station.

### Notes

- Port 58080 must be free. The robot library binds every interface, as on a hub, so Windows may ask
  whether Java may accept network connections. Cancelling keeps the hub reachable from this
  computer only, which is all the tools need.
- The hub exits after two minutes with no Driver Station and no app connected.
- Simulated physics and odometry are estimates, so this complements the
  [hardware checklist](../../docs/hardware-checklist.md); it does not replace it. It covers what step
  7 checks on a real hub, plus the stream's safety rules.

## What `--check` covers

`--check` starts the hub with a 3-second gap between the stream coming up and OpModes being ready,
as on a slow hub, and connects one app during that gap.

1. An app that connects while the robot is starting first gets an empty OpMode list, then the
   complete manifest with OpModes and hardware, without a lifecycle message.
2. Greets like a Control Hub, without a token: `hello` with source `robot`, no simulator-only fields, and `capabilities.live` (the Lumière Live program format).
3. Before any INIT, the manifest lists the project's OpModes and configured hardware, but not the
   SDK's system OpMode. The hardware must include the four drive motors. The localizer can be
   whatever the project's Pedro constants use, because the simulation gives followers their pose
   through Pedro Pathing. The manifest's `pedro` block names the four drive motors, and every device
   Pedro Pathing uses is in the configuration.
4. No lifecycle message before the first OpMode.
5. The desktop app's origin is accepted (HTTP 101).
6. Web pages from other origins are refused (HTTP 403).
7. INIT, START, gamepad, place, and shutdown sent to the robot stream do nothing.
8. Driver Station INIT reaches the app, with the configured hardware in the manifest.
9. Driver Station START reaches the app.
10. Pose and path messages stream while the OpMode runs, at most 20 per second.
11. The robot moves along the path.
12. STOP from the app stops the OpMode, and the Driver Station sees it stop.
13. The SDK's default OpMode is never reported.
14. A client that connects late receives the current manifest and lifecycle.
15. STOP from the app also works during INIT.
16. Driver Station telemetry and the true pose stay off the robot stream.
17. Silent clients are disconnected after 10 s, as `docs/protocol.md` says.
18. Lumière Live refuses pairing and programs while it is not running.
19. Driver Station INIT opens Lumière Live. A late client gets its report, and it refuses a wrong
    pairing secret and a program from an unpaired connection. The check lists its own Lumière Live
    (`harness/java/.../live/VirtualLive.java`), paired with a secret that is new for every run.
20. A paired computer's program is checked against the configuration and Pedro Pathing's devices.
    A program that uses Pedro's front-left drive motor, misuses a device, and names a missing one
    is rejected with those three reasons. A valid one is accepted, and the Driver Station shows it.
21. START runs a paired computer's program: the robot drives the path, the check motor runs at the
    0.6 power cap though the program asks for 1, and the servo reaches its position. In check mode
    the hub adds `lumiere_check_motor` and `lumiere_check_servo` to the configuration for this.
22. Lumière Live stops within 1.5 s when the paired computer goes silent: motors at zero, OpMode
    ended.
23. It stops at once when the paired computer disconnects.
24. A motor that leaves its travel range stops the run.
25. Driver Station STOP ends a Live run at once while the paired computer keeps pinging; the drive
    is at zero power and the robot coasts to rest.
26. No OpMode errors.

## What `--parity` covers

`--parity "<OpMode>" --live-program <file.json> --live-secret-file <file>` runs a project's deployed
autonomous, then the same program through the project's own Lumière Live, recording the robot's true
pose and mechanism outputs from START. The program file is what the app sends (`buildLiveProgram`).
The secret must be the one the project's generated `LumiereLive.java` is paired with. Pass
`--live-opmode` if its Driver Station name is not "Lumière Live". It checks that both:

1. run to the end of the routine;
2. take the same time, within 3%;
3. end at the same pose, within 1.5 in and 3 degrees;
4. drive the same route, within 1.5 in, compared by shape: the Driver Station hears the robot every 100 ms, and the real-time simulator varies by about half an inch from run to run where the robot settles;
5. set the same mechanism outputs in the same order, within 0.3 s.

Set the generated file's power limit to 1 for parity; a lower cap changes the outputs on purpose.

## What `--shakedown` covers

`--shakedown` also lists the OpModes in `harness/java/.../faults/FaultOpModes.java`, which fail on
purpose. They appear in a hub's OpMode list only in this mode.

1. Example TeleOp drives from the virtual gamepad, the app follows the pose, and the robot holds
   still after release.
2. `Session.data` values reach the app, and gamepad A switches the drive mode.
3. An OpMode that throws in `loop()` is stopped, and both the robot stream and the Driver Station report it.
4. An OpMode that throws in `init()` stops without running.
5. A LinearOpMode reports through `Session` and stops promptly on STOP.
6. Awkward `Session.data` values all arrive as valid JSON, and reports keep coming: NaN, infinity,
   null, escapes and Unicode, lists, maps with non-string keys, `long`, and `int[]`.
7. An OpMode that never checks `opModeIsActive()` still stops.
8. Two apps see the same run, and either one can stop it.
9. After all of the above, Example Auto still parks at (36, 24).
10. After **Restart Robot**, the stream comes back on port 58080 with the OpModes and hardware, and
    INIT and STOP work.
11. Only the deliberate faults reported errors.
