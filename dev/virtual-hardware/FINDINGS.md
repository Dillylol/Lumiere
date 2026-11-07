# Findings: virtual hardware runs, 2026-11-07

**Status: everything below is fixed in 0.2.0, except the upstream Pedro Pathing 3.0.2
`reverseTangent()` defect.** Generated code works around that defect with `Headings`; see
docs/compatibility.md. The 0.2.0 fixes:

- The 10-second idle timeout.
- A manifest refresh once the robot finishes starting.
- `Headings` on Pedro 3.0.2.
- Two JSON writer bugs found by `--shakedown`.
- The Robot view issues: duplicate connections, timer, Session data panel, path and target
  overlays, and active OpMode display.
- `.pp` format 2.0.0, through points, and the robot block.

Re-verified on Pedro 3.0.2: `--check` passes 18/18 and `--shakedown` 11/11. Against the real
virtual hub, the Robot view stayed at one connection across a robot restart.

The original report follows. It was tested with the robot library and simulator from this checkout
(`0.0.0-local`, unmodified), FTC SDK 12.0.0, Pedro Pathing 3.0.0 as pinned, and 3.0.2 swapped in
through the init script.

## Robot side (robot library on the virtual hub)

`--check`: 16 of 17 checks pass on both Pedro 3.0.0 and 3.0.2.

- **Boot works unmodified.** `RobotHooks.onCreateEventLoop` starts the stream on port 58080 and
  registers its lifecycle listener. `Manifest.build` reads a real `HardwareMap` correctly at INIT,
  which nothing had exercised before: the drive motors, the Pinpoint as `pinpoint`, and the hub's
  voltage sensor as `Control Hub: voltage`. On a real hub the hub shows up the same way, despite the
  "controllers and hubs are omitted" comment in `Manifest`.
- **The listener order matches SDK 12.0.** This was checked in `OpModeManagerImpl`'s bytecode, then
  exercised end to end. `onOpModePostStop` runs while the stopping OpMode is still active, so
  "stopped" is reported, and the `$Stop$Robot$` default OpMode is filtered out.
- **The safety rules hold.** INIT, START, gamepad, place, and shutdown sent to the robot stream do
  nothing. STOP works while running and during INIT. Other web origins get HTTP 403.
- **Mismatch: silent clients are dropped after 5 s, not 10 s.** `docs/protocol.md` says clients
  must ping every 10 seconds. `StreamServer.begin()` starts NanoHTTPD with its 5-second socket read
  timeout, so a socket that receives nothing for 5 s closes before the 10-second watchdog
  (`CLIENT_TIMEOUT_MS`) runs. The app pings every 2 s and is unaffected. A client that follows the
  document, or a Wi-Fi stall over 5 s, gets disconnected early. The fix is either to correct the
  document or to start the server with a longer read timeout.
- **Before OpMode registration finishes, the manifest can list no OpModes.** This one is from
  reading the code, not from a test. `RegisteredOpModes.getOpModes()` only logs, and does not throw,
  if called before the SDK finishes registering. An app that connects in that window gets an empty
  OpMode list until the next INIT.

## The app's Robot view against a hub

The Robot tab of the web dev server was connected to the virtual hub at `127.0.0.1`. It showed the
robot library version, followed INIT and START from the Driver Station console, drew the robot
parking at (35.97, 23.93) at 224.9°, and its STOP button stopped the OpMode. These issues came up,
all in the shipped `Simulation.tsx` (the `robot` mode shared with the Simulate view):

1. **Duplicate connections after a drop (verified).** After the hub went away, the view showed
   **Connect robot** while its old `StreamClient` kept reconnecting in the background. Pressing
   **Connect robot** created a second client without closing the first. When the hub came back it
   counted **2 app clients** from one view. **Disconnect** closes only the newer client, so updates
   keep arriving. `connect()` should close any existing client, and the view should show
   "Reconnecting" instead of offering **Connect robot** while the client is retrying.
2. **The timer stays at 0.0 s on a hub.** Elapsed time comes only from the simulator's `robot`
   message.
3. **"Waiting for telemetry…" never fills.** Hubs do not stream Driver Station telemetry.
4. **"No localizer reported" always shows.** A hub's `hello` has no `drivetrain` field.
5. **The field draws the project's program, not what the robot follows.** `path` messages from
   `Session` are ignored, so a team running other code sees the robot drive off the drawn path.
6. **The OpMode dropdown does nothing in robot mode.** OpModes start from the Driver Station. It
   also does not follow the running OpMode: it showed Example TeleOp while Example Auto ran.

## Pedro Pathing 3.0.2 (Lumière pins 3.0.0)

From `--probe`. The error is the difference from the interpolator's documented heading, at curve
parameter t from 0 to 1. Worst error, in degrees:

| Path and heading | 3.0.0 | 3.0.2 |
| --- | --- | --- |
| Line, Pedro `linear` | 90 (runs backwards, #176) | 0 |
| Line, `Headings.linear` | 0 | 0 |
| Curve, Pedro `linear` | 0 | 0 |
| Curve, `Headings.linear` | 0 | **9.87** |
| Curve, `Headings.piecewise().facingPoint` | 0 | **20.44** |
| Curve, Pedro `facingPoint` | 0 | 0 |

- **Why.** 3.0.2 passes distance completion, instead of the curve parameter, to every interpolator
  that is not marked geometric. `Headings`' interpolators are plain lambdas, so they convert
  completion again. Its `facingPoint` and `tangent` rules then evaluate the curve at the wrong point.
  Endpoints stay exact.
- **What this affects.** Generated code (for example `Headings.piecewise().constant(...).facingPoint(...)`
  in the sample golden) and the quickstart's `ExampleAuto`, which uses `Headings.linear` on a curve.
- **What still works.** Example Auto parks at (35.98, 23.96) at 225.0° on 3.0.0 and at (35.99,
  23.97) at 225.0° on 3.0.2. End-pose checks such as `ExampleAutoSimulationTest` cannot see this
  error. The contract checks give the same result on both versions.
- **Upgrade path.** On 3.0.1 and later, Pedro's own `linear` is correct on lines and curves. A bump
  to 3.0.2 would switch generated code back to Pedro's interpolators, regenerate the parity
  fixtures, and either retire `Headings` or make it declare `isGeometric()`. Declaring it works on
  3.0.0 too: compiled against 3.0.0 it is a plain method, and on 3.0.2 it overrides the new
  interface default.
- **Other 3.0.1 and 3.0.2 changes relevant here.** `PinpointLocalizer.reset()` now sleeps 500 ms,
  so INIT is longer. `PoseFactory.mirrorX` now uses π − h, and `degrees()`, `of`, and `map` are
  unchanged. `Follower.isBusy()` is false in IDLE and MANUAL. There is a new
  `ManualDrive.driveOrHold`. Controller and Foresight fixes are included.

## Pedro Pathing Visualizer (upstream format 2.0.0)

From `dev/visualizer-compat/check.mjs` against the Visualizer's own fixtures at commit `97104e0`:

- **Matches.** Start poses, end points, control points, every heading type (including legacy
  end-point headings and "continue from previous" piecewise segments), group headings, waits, and
  run order all agree with the Visualizer's own parse. Exports are accepted by its reader's rules
  and round-trip unchanged.
- **Through points are dropped without a warning.** A path drawn with Pedro's `Paths.through` stores
  `throughPoints` and no control points, so Lumière imports it as a straight line. Upstream's own
  `features-1.5.pp` fixture contains one.
- **The `robot` block is ignored without a warning.** That is the robot length and width, speeds,
  and accelerations.
- **Every current file gets the "newer Visualizer" warning.** Lumière writes 1.5.0 and warns on
  anything newer, and the Visualizer now writes 2.0.0.
