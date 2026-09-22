# Production release plan: FTC programming studio (working name "JULES")

## Context

The app is a prototype today.

- **UI:** a large uncommitted React/Tauri rewrite on `main`.
- **Java pane:** read-only.
- **Generated Java:** calls methods that don't exist.
- **Simulator:** a timed animation.
- **Robot link:** a hand-started Python relay.
- **Robot code:** targets FTC SDK 11.0 and Pedro 2.0.6.
- **Repo:** carries duplicate trees, build output, personal data (a token, local paths, season-specific experiments) and a committed signing key.

Meanwhile the FTC ecosystem moved: **FTC SDK 12.0** (2026-27), **Pedro Pathing 3.0.0** (new API), **Ivy 1.1.1** (Pedro's command library) and **Panels 1.0.12**.

**Goal:** a production release that is:
- **easy to download:** one installer, auto-update, no Python, no account, no Android Studio required;
- **friendly and interactive,** with FTC-native terms and links to official docs;
- **a real Java editor** that compiles against the official FTC SDK;
- **standard Pedro 3 + Ivy + Panels code**;
- **delivered as a tiny robot library** via JitPack, plus a quickstart;
- **testable without hardware** by running the team's real Java in a simulator.

**Your decisions:** Pedro 3 + Panels on SDK 12.0; JitPack plus a separate quickstart repo; a real-Java JVM simulator on desktop with a TypeScript preview on web; archive legacy code, then remove it.

**Your constraints:**
- The backend stays as small as possible.
- Nothing personal, and no copied third-party code (dependencies only, never vendored).
- A seamless install.
- The product name must be easy to change.

**Limit:** "no mistakes" here means *verified by compile, tests and simulation*. Behavior on a real Control Hub can't be verified (see the last section). Each phase lands as its own PR with green CI.

---

## Design principles for this release

1. **Light backend.**
   - **Rust:** 4 small commands only. File access uses the official Tauri fs, dialog and persisted-scope plugins.
   - **Robot and simulator:** both talk to the frontend over the *same* WebSocket JSON protocol, so there is one client and no relay.
   - **Robot library:** a handful of classes.
2. **Seamless.**
   - Signed installers for Windows, macOS and Linux from GitHub Releases, with auto-update.
   - Web authoring works immediately with no setup.
   - Java build tools install *on demand* with one click, into app data. Temurin JDK 17 and Android command-line tools come from their official download servers. You accept the Android SDK license in the app, the same way Android Studio asks.
   - An existing Android Studio install is reused automatically.
   - No accounts, no analytics, no AI, no mandatory onboarding. Every wizard step can be skipped.
3. **Nothing personal, no vendored code.**
   - Delete tokens, local paths, personal `.pp`/program files, the shooter-trainer and RPM experiments, and season-specific code.
   - Use synthetic test fixtures only.
   - Third-party code enters only as Maven or npm dependencies.
   - The quickstart is built at creation time from the **official** FtcRobotController v12.0 download plus our own overlay files. Pedro's tuning procedures are not copied; we write a minimal `Tuning.java` against the public `tuning` artifact API.
   - `PedropathingStuff/` stays untracked and gitignored, and nothing uses it.
   - The field is a self-drawn, generic 12×12-tile FTC field; season art can be imported by the user.
   - LICENSE copyright line: "The <App> Contributors".
4. **Easy to rename.**
   - All user-visible names come from `app/src/brand.ts`, re-exported to `tauri.conf.json` (productName, identifier, updater URL) by a small `scripts/brand.mjs` sync.
   - Java group, package and artifact IDs live in `robot/gradle.properties` and the quickstart overlay tokens.
   - `scripts/rename.mjs` rewrites packages, class prefixes and headers in one pass.
   - Neutral internal identifiers, so a rename doesn't break saved projects: file extension `.ftcproj`, schema key `ftcStudio.project`. Existing `.jules` files are still imported.
   - **The first public tag, JitPack coordinates and quickstart repo wait until the name is final.**

---

## Verified ecosystem facts (gh/Maven, 2026-09-12). Code generation must match these exactly.

- **FTC SDK 12.0**
  - Artifacts: `org.firstinspires.ftc:{Inspection,Blocks,RobotCore,RobotServer,OnBotJava,Hardware,FtcCommon,Vision}:12.0.0` on Maven Central.
  - Build: AGP 8.13.2, Gradle 9.1.0, compileSdk 30, minSdk 24, Java 1.8. Never edit `build.common.gradle`.
- **Pedro 3.0.0**
  - Artifacts: `com.pedropathing:revhub:3.0.0`, which brings `core:3.0.0` (Central). `com.pedropathing:tuning:1.0.0` (AutoTune, web UI on :10158) comes from `https://repo.dairy.foundation/releases/`.
  - Constructor order is `Follower(Localizer, Drivetrain, Algorithm)`.
  - `Constants.create(HardwareMap)` builds `new PinpointLocalizer(h, PinpointConfig)`, `new Mecanum(h, MecanumConfig)` and `new Foresight(ForesightConfig)`. Configs take `Configuration<T>` lambdas.
  - Path API: `Paths.line/curve/through/path`, then `.constant/.linear/.tangent/.reverseTangent/.facingPoint/.heading(Interpolator)`.
  - Follower methods: `update()`, `follow(Path)`, `hold`, `manual(...)`, `isBusy`, `pose()`.
  - Bug: `PoseFactory.mirrorX` sets heading to −h instead of π−h, so generated code uses an explicit transform.
- **Ivy 1.1.1:** `com.pedropathing.ivy:core:1.1.1` and `com.pedropathing.ivy:pedro:1.1.1`.
  - `Groups.sequential/parallel/race/deadline/repeat`
  - `Commands.waitMs/waitUntil/instant/conditional`
  - `Scheduler.schedule/execute/reset/cancel`
  - `PedroCommands.follow(follower, path)`
- **Panels 1.0.12:** `com.bylazar:fullpanels:1.0.12` from `https://mymaven.bylazar.com/releases`. From Java, call `PanelsTelemetry.INSTANCE.getTelemetry()` and `PanelsField.INSTANCE.getField()`. Dashboard on :8001.
- **Kotlin:** Pedro pulls Kotlin 2.3.21 and AutoTune pulls 2.4.10, so pin the Kotlin BOM to 2.4.10.
- **`.pp` files:** the Pedro Visualizer 2.0 `.pp` format is `version:"1.5.0"`; the legacy format must also import.
- **Coordinates:** Pedro uses 0–144 inches, origin at bottom-left, heading 0 along +x, counter-clockwise positive.

---

## Repo layout (after cleanup)

```
app/                 (git mv tauri_ui) React/Vite/Tauri
  src/brand.ts       single source of product name/ids/urls
  src/core/          framework-free TS: ir/, pedro/, pp/, codegen/, protocol/, javaHints/
  src/features/      home, setup, build, paths, code, simulate, robot, learn
  src-tauri/src/     lib.rs + toolchain.rs + run.rs + quickstart.rs   (that's the whole backend)
robot/               Gradle 9.1: ftc-lib (Android library, published), sim (java-library, published)
quickstart/          overlay files only (our code) + README template
fixtures/            synthetic .pp, IR, golden Java, sim scenarios
docs/                protocol.md, project-format.md, compatibility.md, install-existing-project.md, hardware-checklist.md
scripts/             brand.mjs, rename.mjs, make-quickstart.mjs
```

---

## Contracts (kept small)

1. **Project format v2** (zod, `app/src/core/ir/schema.ts`, replacing `tauri_ui/src/models/project.ts`)
   - **Robot profile:** mecanum motor names and directions, Pinpoint config, size and mass.
   - **Poses and paths:** `poses[]`, `paths[]` (line or curve segments with control points; heading constant, linear, tangent, reverseTangent or facingPoint).
   - **Subsystems:** `subsystems[]` (devices, named states, safe state).
   - **Programs:**
     - *Autonomous:* start pose, alliance, and a command tree: `followPath`, `wait`, `waitUntil`, `setState`, `sequential`, `parallel`, `race`, `conditional`, `custom{className,method}`.
     - *TeleOp:* robot- or field-centric drive, slow mode, and gamepad bindings (pressed, released, held, toggle).
   - **Validation:** `validate.ts` returns node-anchored problems. Code generation refuses programs with errors.
   - **Migration:** `migrate/v1.ts` imports old projects after writing a backup.
   - **Retired:** the JULES text DSL. Its parser is kept only inside the migrator.
2. **Stream protocol v1** (`docs/protocol.md`)
   - JSON over WebSocket. The robot serves it at `ws://<hub>:58080/stream`; the simulator serves it at `ws://127.0.0.1:<port>/stream?token=…`.
   - **Messages from robot or simulator:**
     - `hello{versions, manifest{devices, opModes, frameworks, tuned}}`
     - `lifecycle`
     - `state{pose, target, voltage, loopMs}`
     - `path{points}`
     - `telemetry`
     - `error{message, stack}`
   - **Simulator-only control:** `init`, `start`, `stop`, `gamepad{…}`, `setPose`.
   - The robot endpoint is read-only apart from `stop`. **Nothing from the laptop can move a real robot.**
3. **Generated files**
   - Every generated file starts with a header: `// Generated by <App> — edit the program in <App> or click "Eject" to own this file. sha256=…`.
   - Writes check the hash. If the file was hand-edited, the user picks **Overwrite**, **Eject** (the file becomes hand-owned) or **Cancel**.

---

## Phases

### P0: Cleanup and rename-ready baseline (S)

1. Create `legacy-archive` from `faaa5fe` (push it only after asking).
2. On `chore/baseline`, commit the current rewrite, excluding `PedropathingStuff/`.
3. Remove:
   - `client/`, `JULES-app/`, `JULEScore/`, `JULESSimulator/`, `virtual_robot-master (2)/`, `JULES4FTC/`
   - `Jules_client.py`, `kill_jules.bat`, `rpm_*.csv`, `tsc_output*.txt`
   - the `TestArticle` and `client/client` gitlinks
   - `tauri_ui/tauri.key(.pub)`
   - the untracked `android-ci.yml`
   - the Ollama and robot-context Rust modules, plus every `@ts-nocheck` orphan UI file
   - the three.js and reactflow dependencies
4. `git mv tauri_ui app`.
5. Add `brand.ts` plus `scripts/brand.mjs`, and `scripts/rename.mjs` (dry-run and apply).
6. `.gitignore` gets `**/build/`, `dist`, `.gradle/`, `local.properties`, `target`, `*.key`, `PedropathingStuff/`.
7. Add LICENSE (BSD-3-Clause, "The <App> Contributors"; you can change it any time before the first release).
8. **Your one action:** rotate the updater key and update the CI secrets. The old key is in git history.

**Exit:** `npm ci && tsc --noEmit && npm test && npm run build` passes, and so does `cargo clippy -D warnings`. A grep for `dylen|Dillylol|token|C:/Users` across tracked files finds nothing personal. Deliberately configured repo URLs live only in `brand.ts`.

### P1: Spike gates (M; settle the risky parts first)

**G1: dependencies compile together.**
- `node scripts/make-quickstart.mjs --out <tmp>` downloads the official v12.0 zip and applies the overlay (FTC 12.0, revhub, tuning, Ivy, Panels, Kotlin BOM, plus `--include-build robot`).
- `:TeamCode:assembleDebug` must pass. The dex step catches class conflicts.
- Also compile the Pedro 3 docs' auto and teleop shapes, written fresh from the docs' API.

**G2: real Java on the desktop JVM, in real time.** No bytecode rewriting.
- Inside the quickstart's local unit-test environment, a `sim` harness must:
  - build a real `HardwareMap` with fake motor, IMU, voltage and Pinpoint devices;
  - run iterative and `LinearOpMode` lifecycles on an OpMode thread (a tiny helper in package `com.qualcomm.robotcore.eventloop.opmode` if package-private access is needed);
  - step a physics thread at 1 kHz wall-clock;
  - have a real `Follower` complete a 48-inch line;
  - have Ivy `waitMs` and `Gamepad.aWasPressed()` work;
  - survive Panels calls.
- If a fake Pinpoint subclass isn't possible, fall back to a one-line `Sim.localizerOr(...)` hook in the quickstart's `Constants.create`.
- If official classes can't run at all, fall back to an "SDK shim" jar with identical signatures, clearly labeled in the UI. Record the result in `docs/simulator.md`.

### P2: Core model (L)

- `core/ir/{schema, validate, migrate/v1}.ts`
- `core/pedro/{bezier, heading, poses, preview}.ts`: kinematic preview with a trapezoidal speed profile.
- `core/pp/{parse, serialize}.ts`: legacy format and 1.5.0; unknown fields are preserved.
- `core/protocol/stream.ts`

**Tests:**
- vitest and fast-check.
- `.pp` round trip on synthetic fixtures.
- Pedro parity: a JUnit test in `robot/sim` runs real `core:3.0.0` and writes `fixtures/parity/paths.json` (committed); vitest checks the TypeScript geometry matches within 1e-9.
- v1 migration fixtures.

### P3: Robot library and simulator (M)

**`robot/ftc-lib`** (Android library, Java 8, no Kotlin; FTC, Pedro, Ivy and Panels are `compileOnly`; its only runtime dependency is `nanohttpd-websocket` with `nanohttpd` excluded, since RobotCore already ships it). Five classes:
- `Runtime.attach(OpMode)` returns a session with `.follower(f)`, `.update()` and `.close()`. It sends telemetry to the Driver Station, Panels and the stream.
- `Hooks`: `@OnCreateEventLoop` starts and stops the server.
- `Manifest`: built from `hardwareMap` and the registered OpModes.
- `StreamServer`: WebSocket, 20 Hz, times out idle clients, catches all errors so the OpMode is never affected.
- `SafeStop`
- Panels and Pedro adapters load only when their classes exist.

**`robot/sim`** (java-library):
- fake devices
- `MecanumModel`: motor curve, voltage, traction, mass, walls
- the lifecycle harness
- a WebSocket server using the same protocol
- scenario assertions for CI

**`jitpack.yml`** is ready but unused until the name is final.

**Tests:** JVM unit tests (manifest, message JSON, server start/stop, adapters present and absent, physics sanity) plus `lintRelease`.

### P4: Java code generation and quickstart overlay (L)

`core/codegen/java/{names, paths, subsystems, autonomous, teleop}.ts` writes to `teamcode/<app>/generated/`.

- **Paths class:** poses and `Path` methods using `line(...)` or `curve(...)` with heading methods.
- **Subsystem classes:** one per subsystem, with a state enum and a safe state.
- **Autonomous:** an iterative `@Autonomous` OpMode following the Pedro 3 docs.
  - `init`: `Scheduler.reset`, `Constants.create`, `setPose`
  - `start`: `schedule(sequential(follow(...), waitMs(...), ...))`
  - `loop`: `follower.update(); Scheduler.execute(); session.update()`
  - `stop`: safe states
- **Alliance mirroring:** an explicit `PoseFactory.degrees().map(...)` using 144−x and π−h.
- **TeleOp:** `follower.manual(...)` or field-centric drive, slow mode, and `gamepadN.xWasPressed()` bindings that schedule Ivy commands.

**`quickstart/` overlay** (our files only):
- `build.dependencies.gradle`
- `TeamCode/<app>.gradle`: unit-test options and the simulator dependency.
- `pedro/Constants.java`:
  - `drivetrainConfig`, `localizerConfig` and `foresightConfig`, using AutoTune's names;
  - starter Foresight values measured in the simulator;
  - `TUNED = false`, which shows a warning in telemetry and the manifest.
- `pedro/Tuning.java`: minimal, written against the `tuning` API.
- `examples/ExampleAuto.java`, `examples/ExampleTeleOp.java`
- A `README` covering install, manual install into an existing project, a compatibility table, ports (Panels 8001, AutoTune 10158, app 58080), tuning order and troubleshooting.
- A GitHub Actions build workflow.

**Tests:**
- `fixtures/ir/*.json` produce `fixtures/golden/java/**`.
- CI makes a quickstart, adds the golden files and compiles with `-Xlint:all -Werror` against FTC 12.0, Pedro 3, Ivy, Panels and the local `ftc-lib`.
- The simulator scenario checks that the example auto ends within 2 in / 5° of the target pose.

### P5: App experience (XL; runs alongside P3–P4)

- **Home:**
  - Big "New program" button with templates: Blue/Red autonomous, field-centric TeleOp, hardware check.
  - Recent projects; import `.ftcproj`, `.jules` or `.pp`.
  - Friendly empty states. No forced onboarding; a dismissible "Get started" checklist instead.
- **Build (blocks):**
  - Drag-and-drop command tree (`@dnd-kit`) with keyboard moves and an inspector that has device and state dropdowns.
  - TeleOp bindings editor with a gamepad picture.
  - Inline problems.
  - Live Java preview; selecting a block highlights its lines.
- **Paths:**
  - SVG field 0–144 with y pointing up.
  - Draggable poses and Bezier handles, heading ring, snapping, arrow-key nudge.
  - Pedro and FTC coordinates both shown.
  - Mirror preview and a timeline scrubber playing the kinematic preview.
  - `.pp` import/export.
- **Code (desktop), see P6:** the real Java editor. On web it shows the read-only generated Java with a copy/download button.
- **Simulate:**
  - Driver Station-style OpMode picker, INIT → START → STOP, 0:30 and 2:00 timers.
  - Telemetry pane and a field showing the robot, target and path.
  - Gamepad: on-screen, keyboard or USB controller.
  - Web shows a clearly labeled "Preview"; desktop shows "Real Java".
- **Robot:**
  - Auto-detect a hub at 192.168.43.1 or 192.168.49.1.
  - Status cards: versions, Pedro/Panels detected, the tuned flag.
  - Import devices into the robot profile after a diff.
  - One-click **Deploy**.
  - Buttons to open Panels and AutoTune.
  - Live field overlay.
- **Learn:** short original lessons with "Read more" links to ftc-docs.firstinspires.org, the Pedro 3 docs, the Panels docs and the Game Manual (links only, nothing copied).
- **Shell:**
  - Undo/redo with zustand and immer.
  - Autosave, keeping the 750 ms debounce and recovery drafts from `App.tsx`.
  - Ctrl+S, clicking a problem jumps to it, and programs can be renamed, duplicated and deleted.
  - Themes; accessibility (axe-clean, keyboard reachable).

### P6: Desktop Java editor, build tools and simulator runner (XL)

**Rust, the whole backend (four commands):**

| Command | What it does |
|---|---|
| `toolchain_status()` | Finds an existing Android Studio JBR or SDK, or the app-installed tools. |
| `toolchain_install(Channel)` | Downloads Temurin JDK 17 plus Android command-line tools into app data. Shows the SDK license, which you accept in the UI, then installs `platform-tools`, `platforms;android-30` and `build-tools`. Progress and cancel. |
| `run(tool: gradle\|adb\|java, args, cwd, Channel)` / `cancel(id)` | Allowlisted executables only. Streamed output, kills the whole process tree. |
| `quickstart_create(dest)` | Downloads the official FtcRobotController v12.0 zip, extracts it and writes the overlay files embedded in the app. |

Plugins: fs with a persisted scope on the linked folder, dialog, opener, updater, process.

**Code feature:**
- Open or link an FTC project folder: file tree, tabs, unsaved markers, reload prompt when files change on disk.
- Generated files are locked, with **Eject**.
- **Check / Build:** runs `:TeamCode:compileDebugJavaWithJavac` on the Gradle daemon. javac output becomes Monaco markers and Problems entries with jump-to-line.
- **Deploy:** `adb connect <hub>:5555`, then `:TeamCode:installDebug`.
- The OpMode list comes from `@TeleOp`/`@Autonomous` annotation matching.
- Completions come from `core/javaHints/*.json`: a hand-written list, in our own words, of the commonly used FTC, Pedro, Ivy, Panels and library signatures with links to the official docs. Also snippets and identifiers from open files. No language server, no bundled third-party docs.
- "Paste AutoTune results" replaces the config block in `Constants.java`, with a diff preview.
- "Open in Android Studio" button.

**Simulator runner:** `run(gradle, [":TeamCode:<app>Simulate", "-Popmode=…", "-Pport=…", "-Ptoken=…"])`. That task is a unit-test entry point defined in the overlay. The frontend connects straight to the simulator's WebSocket; stop sends `stop`, then cancels.

**Tests:**
- cargo: allowlist enforcement, tree kill, toolchain detection on temp layouts.
- vitest: javac-output → marker mapping.
- Playwright on web.
- A nightly desktop smoke test: create quickstart → build → introduce an error → marker appears.

### P7: Release, CI and docs (M)

- **CI:** `ci-app` (lint, tsc, vitest, golden check, Playwright + axe, build), `ci-tauri` (fmt, clippy, test on win/mac/linux), `ci-robot` (ftc-lib + sim build, test, lint, parity), `ci-quickstart` (make quickstart → golden compile → sim scenarios).
- **Release:** tauri-action for Windows `.msi`/`.exe`, macOS `.dmg` (universal) and Linux `.AppImage`/`.deb`, with updater artifacts and draft GitHub Releases. Code signing is supported through secrets; without certificates, users see SmartScreen and Gatekeeper warnings (see decisions).
- **Web:** the PWA build is ready; hosting it (e.g. GitHub Pages) only after you ask.
- **Docs:** `docs/*` as listed; update ROADMAP.md for the JVM simulator, DSL retirement and Panels.
- **Naming gate:** when the name is final, run `rename.mjs`, then (after asking) push the quickstart repo, tag `v1.0.0` (JitPack and installers) and publish the release.

---

## Verification (no hardware)

1. `cd app && npm ci && npx tsc --noEmit && npm test && npm run golden:check && npx playwright test && npm run build`
2. `cd app/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`
3. `cd robot && ./gradlew :ftc-lib:assembleRelease :ftc-lib:testReleaseUnitTest :ftc-lib:lintRelease :sim:test publishToMavenLocal`
4. `node scripts/make-quickstart.mjs --out %TEMP%/qs`, then in that folder run `gradlew.bat :TeamCode:assembleDebug :TeamCode:testDebugUnitTest --include-build <repo>/robot`. This compiles against the official SDK 12.0 and runs the simulator scenarios.
5. `node scripts/rename.mjs --dry-run --name TestName` shows a complete, clean rename; applying it to a temporary copy still builds.
6. Desktop run (`npm run tauri dev`), fresh app data:
   - install tools → create quickstart → build an auto with blocks and paths
   - Check shows no problems → break a line → marker appears → fix
   - Simulate: INIT, START (robot follows the path, telemetry streams), STOP
   - TeleOp with the keyboard gamepad
7. Web (`npm run dev`): the same authoring flow with preview, `.pp` round trip, and it still works after going offline.

## Can't be verified without hardware (documented, mitigated)

- Real Control Hub loop timing, Pinpoint I2C, and Panels, AutoTune and ftc-lib runtime on SDK 12.0. Mitigation: dex build and simulator runs.
- Hub discovery, `adb connect` and deploy over robot Wi-Fi.
- Real tuning values and the accuracy of the simulator's starter constants. Mitigation: `TUNED=false` warnings and a low-power first-run checklist.
- Motor and pod directions, sensor data, and physical gamepads through the Driver Station.

**Mitigation:** `docs/hardware-checklist.md`, versions and the tuned flag shown in the Robot tab, recorded sessions for later comparison, and a read-only robot endpoint.

## Order and the few things I'll ask you

**Order:** P0 → P1 → P2 + P3 → P4 → P5 (alongside P3–P4) → P6 → P7. Each step is one PR with green CI.

**I'll ask before:**
- pushing any branch
- creating or pushing the quickstart repo
- tagging or publishing a release
- hosting the web build

**Your actions and decisions:**
- rotate the updater key
- the final product name (any time before the first tag)
- whether to buy code-signing certificates (Apple Developer ID and Windows signing) for warning-free installs
