# Release progress

Updated 2026-11-10. This record separates what has been verified locally from what still waits on hardware,
continuous integration, or release decisions. Versions 0.1.1, 0.1.2 and 0.2.0 are released at github.com/Dillylol/Lumiere, with the robot library on JitPack; 0.3.0 is tagged from this record.

## Unreleased

- **Unfinished actions no longer break saving.** Adding "Set mechanism state" before any mechanism had states left the action empty. The project could then no longer be saved, and the error was the schema's raw JSON.
  - **Saving:** an action or button whose path, mechanism or state is not chosen yet now saves. Problems says what to choose ("Choose a mechanism and a state for this action").
  - **The editor:** "Set mechanism state" starts on the first mechanism that has states, and is disabled, with the reason, until one exists. "Follow path" is disabled until the program has a path.
  - **Problems names where each problem is,** such as "Main Auto · action 3". Clicking a routine problem selects that action in Build.
  - **Save errors are sentences** that name the program, action, mechanism or path, never raw JSON.

## Version 0.3.0

- **Lumière Pathing Visualizer:** [Pathing](pathing.md) replaces Paths and the embedded Visualizer. It is a credited React rebuild of the Pedro Pathing Visualizer that edits programs directly: drags are single undo steps, all heading rules are editable, mirroring works on the data, and the routine is timed on a timeline with playback. `.pp` import and export remain.
- **Robot profile:** project format 3 reads drive motors, the localizer, speeds and decelerations from the linked project's Pedro 3 constants class, and stores the robot's configured hardware. Conflicts between the two show in Problems. Version 2 projects upgrade on load, with a `.v2.bak` copy on desktop.
- **Physics-bound timing:** path times come from the robot profile, limited by direction of travel, curvature and turn rate, replacing the fixed trapezoid preview.
- **The simulator works from Pedro Pathing alone:**
  - **Pose:** followers read the simulated pose through Pedro's `Localizer` interface, so any robot
    simulates: a Pinpoint, OTOS, OctoQuad, two or three dead wheels, or none.
  - **Motion:** the drivetrain reaches the top speeds and coasting decelerations from the team's
    `ForesightConfig`.
  - **Tested** on a modernized team robot with three dead wheels and an IMU. Its autonomous ran end
    to end with the follower's pose matching the simulated robot. The virtual hub passes 18/18 on
    that robot and on the quickstart.
- **Pedro Pathing's devices are identified, not asked for:**
  - **Robot side:** the hardware scan's manifest names every device the team's Pedro constants give
    Pedro Pathing (drive motors, dead wheels, IMU, Pinpoint, OTOS or OctoQuad). It uses Pedro's own
    setting names as roles, read from the constants class on the robot.
  - **App side:** the app reads the same devices from Constants.java, with each dead wheel's direction
    and ticks-to-inches, and fills gaps from the robot's report.
  - **Checks:** mechanisms can't use a drive motor, or an encoder target on a motor whose encoder
    port carries a dead wheel; both are errors. Problems also flags Pedro's devices that are missing
    or of the wrong type, and the constants and robot disagreeing.
  - **Fixes:** the manifest no longer drops names that differ only in case. Sensors and other devices
    are listed, but Lumière does nothing with them yet. The simulator and virtual hub can list
    analog, camera and custom-driver devices without simulating them.
- **Lumière Live: autonomous programs run from this computer without rebuilding the robot code:**
  - **Pairing:** turning on Live runs on the Robot page pairs this computer with a random secret kept on this computer only.
    - Deploys, and the Code page, then add a generated `LumiereLive.java` carrying the secret's SHA-256, the team's Pedro constants class and the mechanism power limit (0.6 unless set on the Robot page).
    - Turning Live runs off and deploying removes the file, even when outdated files are kept.
    - "Lumière Live" is reserved as an OpMode name.
  - **INIT:** when the Driver Station initializes Lumière Live, Robot mode pairs and sends the open autonomous, and sends it again when it changes before START.
    - The program carries exactly the numbers the generated Java uses: the same poses and heading rules, rounded the way the generator writes them.
    - The robot library's `LiveRunner` checks it: missing or mistyped devices, Pedro's drive motors, encoder targets on dead-wheel ports, and encoder targets without a travel range or outside it.
    - A program that passes is set up as the generated `init()` would set it up: the follower at the start pose, the mechanisms' devices, and their starting states.
  - **START:** the routine runs with the generated Java's Pedro Pathing paths and Ivy commands, with mechanism powers capped at the limit.
  - **Stopping:** a run stops when the paired computer is silent for more than 1 s (the app pings every 250 ms while paired), when it disconnects, when a motor leaves its travel range, or on any error.
    - Stopping sets mechanism motors and continuous servos to zero, leaves servos where they are, stops the follower, and ends the OpMode.
    - Driver Station STOP always works.
  - **Travel ranges:** motors that take encoder targets get an optional travel range on the Robot page. Lumière Live requires one, and targets outside it are errors in Problems.
  - **Refused:** programs while Lumière Live isn't running, a wrong secret (the fifth wrong attempt closes the connection), programs from unpaired connections, and programs after START.
  - **Simulator:** it now gives Lumière Live's follower the simulated pose, as it does for any OpMode's follower.
  - **Robot mode** (the Lumière Live panel in Pathing → Robot):
    - **Before INIT:** it says when the robot library predates Lumière Live (the stream's `hello` now lists `capabilities.live`) or Lumière Live isn't installed yet, and reminds teams to turn Live runs off before competitions.
    - **The run:** a Live run of the open program is drawn against the plan like the program's own OpMode, and its routine time goes to the program's run comparison.
    - **After the run:** how it ended (finished with its time, or stopped with the reason) stays in the panel, with the run on the field, until the next INIT. Driver Station STOP during a run now reports the run as stopped.
    - **In the background:** browsers run a hidden page's timers about once a second, which made runs stop on silence. The connection now also pings when the robot's messages arrive.
  - **Deploy:** warns when TeamCode's robot library is older than 0.3.0, the first with Lumière Live.
  - **Docs:** a team guide, [Lumière Live](live.md), and real-hub checks in the [hardware checklist](hardware-checklist.md) (step 9).
  - **Tested:**
    - **Unit tests:** the robot library's 52 tests cover the run, the cap and every stop path with stand-in hardware.
    - **Virtual hub:** 26/26 checks on the quickstart and on the modernized team robot, including the run, the cap, and stops on silence (1.0 s), on disconnect, on a motor leaving its travel, and on Driver Station STOP.
    - **Parity (new `--parity` mode):** on that robot, Lumière Live ran its real autonomous like the deployed OpMode. Routine times were within 0.3%, the routes and end poses within the simulator's own run-to-run variation (about an inch at most), and all 16 mechanism output changes matched.
    - **In the app:** on the virtual hub with that robot, the app paired, sent the autonomous, and the check passed. START ran it to the finish in 23.5 to 23.6 s, filed under the program in the run comparison. With the app's page hidden, its timers ran once a second but its pings stayed at most 347 ms apart, and the run held until STOP.
  - **Robot library:** teams need robot library 0.3.0 for Lumière Live. Deploy warns when TeamCode uses an older one.
- **Simulate and Robot inside Pathing:** Pathing has Develop, Simulate and Robot modes, and the Simulate tab is gone. Runs are drawn against the plan: the plan fades, a ghost robot shows where the estimate puts the robot, and the robot's trail, follower path and distance off the plan are shown. TeleOp programs open in Simulate. The desktop simulator's controls are covered by unit tests with a fake stream; they have not yet been run in the desktop app.

## Version 0.2.0

- **Pedro Pathing Visualizer, embedded:** the Pedro Pathing Visualizer (since replaced by [Pathing](pathing.md)) is
  in Paths → Visualizer, themed for Lumière, with its Apache-2.0 license and NOTICE. Drafts apply to
  the selected autonomous program and open Simulate.
- **Dependencies:** Pedro Pathing 3.0.2, AutoTune 1.0.3 (procedures from Pedro Quickstart
  `4f33ef5b`), and Panels 1.0.20. Generated reverse-tangent headings use `Headings`, because
  Pedro 3.0.2's own `reverseTangent()` is wrong on curves. See [compatibility](compatibility.md).
- **Robot library:**
  - Idle clients are dropped after the documented 10 s, instead of 5.
  - The manifest is refreshed once the Robot Controller finishes starting.
  - `Headings` is correct on Pedro 3.0.0 through 3.0.2.
  - The JSON writer handles every array type, and maps with non-string keys no longer disable
    `Session`.
- **Robot view:**
  - One connection per view, even across robot drops.
  - A running timer.
  - `Session.data` values, loop time, and follower mode.
  - The streamed path and target drawn on the field.
  - The active OpMode shown read-only.
- **Generated autonomous programs** report their routine time and revision through `Session`. The
  Run comparison panel compares simulator and robot runs.
- **The desktop simulator** starts at the program's start pose with the project's robot footprint,
  or with a simulator JSON chosen under Robot model.
- **`.pp` import and export:** format 2.0.0 is read and written. Paths drawn through points become
  the same Bezier curve, and the file's robot settings are reported instead of ignored.
- **Virtual hardware test bench** (development only, under `dev/`): it runs the unmodified robot
  library on the simulator as a virtual Control Hub. It has contract checks, a shakedown, a heading
  probe, and a Visualizer compatibility check; see `dev/virtual-hardware/README.md`.

0.2.0 verification on Windows 11:

| Check | Result |
| --- | --- |
| Robot library and simulator | 48 JUnit tests and lint pass, compiled against Pedro Pathing 3.0.2 |
| App, core, and desktop bridge | 116 Vitest tests in 18 files; production build |
| Browser workflows | 14 Playwright tests, including the Visualizer, the Robot view, and Run comparison |
| Rust backend | 32 tests (4 ignored network tests), `cargo fmt --check`, `clippy -D warnings` |
| Quickstart with the new pins | Official SDK + overlay: `assembleDebug` (dex), unit tests including golden simulations and the Java hints check, and the interactive simulator smoke test (Example Auto parks at 35.98, 23.96) |
| Virtual hub on Pedro 3.0.2 | `--check` 18/18, `--shakedown` 11/11; the real Robot view keeps one connection across a robot restart |
| Visualizer compatibility | Upstream fixtures at `97104e0`: no differences beyond warnings |

## Status by phase

| Phase | State | Notes |
| --- | --- | --- |
| P0 Cleanup and baseline | Done | Legacy code archived on the local `legacy-archive` branch, then removed. Branding centralized; rename tools. |
| P1 Spike gates | Done | FTC SDK 12.0 + Pedro Pathing 3.0.0 + AutoTune + Ivy 1.1.1 + Panels 1.0.12 build and dex together. Official SDK classes run real OpModes on the desktop JVM. See [simulator](simulator.md). |
| P2 Core model | Done | Project format v2, validation, version 1 migration, Pedro geometry with Java parity fixtures, preview timeline, Visualizer `.pp` import and export, stream client. |
| P3 Robot library and simulator | Done | `robot/ftc-lib` (live data, `Headings`, stream server) and `robot/sim` (hardware, mecanum physics, lifecycle, WebSocket control). |
| P4 Code generation and quickstart | Done | Golden Java compiles against the real libraries and runs in simulation. Quickstart = official SDK download + overlay. |
| P5 App experience | Workspace built and validated | `app/src/studio`: projects, visual routines, TeleOp bindings, mechanisms, path editor, generated Java, preview and desktop simulator, robot tools. |
| P6 Desktop | Backend and editor done | Toolchain detection and install, project creation, Gradle/adb runner, build-output problems, simulator launcher. Editor logic in `src/core`: OpMode discovery, AutoTune paste, and Java completions. |
| P7 Release | 0.1.1, 0.1.2 and 0.2.0 released; 0.3.0 tagged | Named Lumière, repository `Dillylol/Lumiere`. The tag workflow builds installers for Windows, universal macOS, and Linux; JitPack builds the robot library. Version 0.1.2 adds the finished flame identity, wide-screen layout, and signed auto-updates. SignPath code-signing approval is pending. |

## Verification record

Local checks on Windows 11:

| Check | Result |
| --- | --- |
| Robot library and simulator (`robot/`) | 43 JUnit tests pass (25 `ftc-lib`, 18 `sim`), plus lint |
| App, core, and desktop bridge | 105 Vitest tests pass across 16 files, including Pedro parity within 1e-6, golden Java output, IPC settlement, simulator cancellation, SDK connection planning, project templates, and the flame identity |
| Rust backend | 32 regular tests and all 4 ignored network/integration tests pass; `cargo fmt --check` and `clippy -D warnings` are clean |
| Rust IPC tests | The registered commands accept the frontend's camelCase arguments |
| Project creation parity | Rust `quickstart_create` and `scripts/quickstart.mjs` produce the same 130 files byte for byte |
| Real tool install | From an empty folder: Temurin 21, command-line tools 19.0, and the four SDK packages. Checksums verified; a path containing spaces works. |
| Build with only installed tools | A project created by the Rust code builds (`assembleDebug`) and passes its simulation test. No Android Studio and no `local.properties`. |
| Interactive simulator | On port 0, as the app requests: Example Auto parks at (35.97, 23.94). |
| Build errors | Real Gradle 9.1 output for syntax, symbol, type, and dependency errors becomes file, line, and column problems. |
| Rename | Applied as Lumière: 34 Java files moved to `dev.lumiere`, goldens and Java hints regenerated. Every check in this table was run again afterwards. Accented names keep their accents where people read them and use an ASCII spelling (`lumiere`, `Lumiere`) for packages, classes, and the executable. |
| Java editor helpers | OpMode discovery and AutoTune paste are tested on the quickstart files. A generated project compiles after pasting Mecanum, Pinpoint, Foresight, and a Pinpoint-to-two-wheel switch. |
| Java completions | All hints match the real FTC SDK 12.0, Pedro Pathing, Ivy, Panels, and robot-library classes by reflection (`JavaHintsTest`). Deliberately wrong entries fail the test. All documentation links return HTTP 200. |
| JitPack coordinates | `publishToMavenLocal -Pgroup=com.github.<owner>.<repo> -Pversion=<tag>` produces `ftc-lib` and `sim` POMs with matching coordinates |
| Connecting an FTC SDK project | 13 core tests (inspection, and deploy planning with renames, package changes, hand edits, team files, and duplicate OpModes) and 3 Rust tests for adding libraries. The desktop app was driven over WebView2's DevTools protocol against a plain official FTC SDK 12.0: it detected the missing libraries and paused automatic deploys, added the libraries, and deployed automatically. It then handled a rename, kept a hand edit until Overwrite, deployed in manual mode, and moved the package, and the SDK project built with `assembleDebug`. No serious axe findings in the panel. |
| Script tests | 5 Node tests pass (brand sync, rename, accented names, Java package moves, and injection) |
| Browser workflows | Playwright at 1366×768 and 820×600: create from templates, edit routines (add, reorder, undo), drag and nudge waypoints, edit path headings and curves, generated Java, preview play and reset, command palette, export, reload persistence, TeleOp bindings with mechanisms, program delete and undo, settings, help, and import. No serious axe findings, no console errors, no sideways scrolling, and the whole field stays visible. |
| Visual identity | The graphite, warm-light, and high-contrast themes use the Lumière flame mark. The generated Windows, macOS, and Linux application icons remain legible at 32 px and are included in desktop packaging. |
| Wide-screen layout | The home screen uses the full content area at 2560×1400 (2360 px after the sidebar), with no horizontal overflow or console errors. The minimum 820×600 layout still passes the complete browser workflow. |
| Windows installers | The current 0.1.2 source produces `Lumière_0.1.2_x64_en-US.msi` and `Lumière_0.1.2_x64-setup.exe` (unsigned) around `lumiere.exe`. The MSI's product name keeps its accent, and so does the release app's window title. |
| Auto-update | A rotated updater key is trusted by the app, its private key and password are stored in GitHub Actions secrets, and the desktop UI checks, downloads, verifies, installs, and restarts. A local signed NSIS build produced its `.sig` artifact. Version 0.1.1 still requires one manual download because updater support cannot be added retroactively; 0.1.2 and later can update in-app. |
| GitHub CI | App, desktop (Windows, macOS, Linux), robot library, and quickstart workflows pass on `9f07db9`. |
| Release 0.1.1 | The tag workflow built all seven installers. JitPack built `ftc-lib` and `sim`, and a release-mode project using them from JitPack builds its APK and passes its simulation test. The Windows installer downloads without signing in. |
| Desktop release app | Driven over WebView2's DevTools protocol: loads, detects tools, saves projects to app data, renders Monaco under the production CSP, runs a Gradle check through the backend, and starts the simulator. The webview connects and Example Auto parks at (35.99, 23.98). No console errors. |

Not yet verified:
- **Other platforms:** CI builds and tests pass on macOS and Linux, but nobody has installed and used the app there yet.
- **Hardware:** see the [hardware checklist](hardware-checklist.md).
- **Native dialogs:** folder and save pickers need a person; the desktop smoke test covers everything around them.

## Decisions made during implementation

- **Android command-line tools 19.0:** version 22.0 deprecates `sdkmanager`, and 23.0 routes it through a new "Android CLI". That CLI downloads further unpinned binaries and enables usage metrics by default. In testing it also ignored `--sdk_root` and installed into the home folder instead.
- **Temurin 21:** it matches the JDK used in CI. Builds accept an existing Java 17 through 21, preferring Android Studio's bundled JDK.
- **Port 0 for the simulator:** it binds a free port and reports it, which avoids a race and a backend helper.
- **Pedro Pathing 3.0.0 heading defect:** linear headings run backwards on lines. Generated code works around it with `Headings`; details are in [compatibility](compatibility.md). It is reported upstream as Pedro-Pathing/PedroPathing#176.
- **Windows test binaries:** they embed the Common Controls manifest so Tauri's IPC tests can start.
- **No service worker in the desktop app:** only web builds include the offline service worker. In the desktop webview it kept serving the previous build's files after an update; Tauri builds now leave it out (`TAURI_ENV_PLATFORM` in `vite.config.ts`). A release app created a project, saved it as a `.lum` file, and listed it again after a reload.
- **Dropped from the original plan:** golden Java is compiled with the FTC SDK's normal settings, not with warnings as errors, because the SDK's Java 8 target itself triggers javac option warnings. Property-based tests were not added; fixture and parity tests cover the geometry.

## Before the next release

- **Auto-update:** 0.1.2 is the first updater-enabled build. Users on 0.1.1 must download 0.1.2 once; future signed releases can then be installed from Lumière's Settings screen. Keep the updater private key backup and its password: losing either would break updates for installed copies.
- **Robot library:** release builds create projects that use `com.github.Dillylol.Lumiere:ftc-lib:v<version>` from JitPack, where `<version>` is the app version, so every release needs its matching tag. Development builds keep using the local `robot/` folder.
- **Stable identifiers:** the app identifier is `dev.lumiere.desktop`, and the MSI upgrade code is pinned in `tauri.conf.json`. Neither may change after the first public release: installed copies would lose their app data, and Windows would install a second copy instead of upgrading. `rename.mjs` leaves both alone, along with the `studio` storage namespace and the `.lum` project file extension.
- **Signing:** decide on code-signing certificates for Windows and macOS.
- **Publication:** creating the quickstart repository, new tags and releases, and web hosting each wait for explicit approval.
