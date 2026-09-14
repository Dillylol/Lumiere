# Desktop

Frontend access to the desktop backend (`app/src-tauri`). Everything here needs the desktop app, so call
`isDesktop()` first. The web app only uses the preview.

| File | Purpose |
| --- | --- |
| `backend.ts` | Typed wrappers for the backend commands: `toolchainStatus`, `installToolchain`, `createRobotProject`, `addSdkLibraries`, `runTool`, and `cancelTask` |
| `ftcFolder.ts` | Reads a connected FTC SDK project for inspection and deploy planning, and applies deploy plans with atomic writes |
| `robotProject.ts` | Everyday actions: Gradle task lists for check, build, and deploy, `adbConnect`, and `startSimulator` |

## Backend commands

| Command | What it does |
| --- | --- |
| `toolchain_status` | Finds Java 17 to 21 and the Android SDK: Android Studio's Java, `JAVA_HOME`, `ANDROID_HOME`, the default SDK folder, or tools this app installed. Nothing is run. |
| `toolchain_install` | Downloads Eclipse Temurin 21 and the Android command-line tools from their official servers, verifies them by SHA-256 (`app/src-tauri/toolchain.json`), and installs the SDK packages robot projects need. |
| `quickstart_create` | Creates a robot project: the official FTC SDK 12.0 download plus Pedro Pathing, Panels, and the examples from `quickstart/overlay`. The output is byte-identical to `scripts/quickstart.mjs`. |
| `sdk_add_libraries` | Adds what generated code needs to an existing FTC SDK project: `TeamCode/libraries.gradle` and its apply line, the simulator entry point, and optionally the Pedro Pathing constants and AutoTune procedures. Existing files are never replaced. |
| `run` | Runs the project's own `gradlew` or the SDK's `adb`, and no other program. It sets `JAVA_HOME` and `ANDROID_HOME` from the detected tools and passes only `SIM_TOKEN` through from the frontend. |
| `cancel` | Stops an install, a project creation, or a run, including every process a Gradle build started. |

Long operations return a task id right away; events arrive on a channel. The wrappers turn this into
`{ id, result, cancel }`.

## Flows

**Setup.**
1. Call `toolchainStatus()`.
2. If `ready` is true, setup is done.
3. Otherwise show what is missing. When any Android item is missing, show a checkbox for the Android SDK License at `status.install.licenseUrl`.
4. Call `installToolchain(accepted, onEvent)`. Show `step` messages and `progress` byte counts; `log` lines belong in a details view.
5. Installation reuses Android Studio's tools when they are present.

**New project.**
1. Pick an empty or new folder with the dialog plugin.
2. Call `createRobotProject(path)`. The app keeps file access to the created folder across restarts.
3. To open an existing project, use `open({ directory: true, recursive: true })`.

**Check and build.**
1. Run `gradle(projectDir, GRADLE_TASKS.check, onEvent)`.
2. Collect the `stdout` and `stderr` lines and pass them to `parseBuildOutput(lines, projectDir)` from `src/core`.
3. Each problem has a project-relative `file`, `line`, and `column` for editor markers. When there are no compile errors, show `failure` instead.

**Editing Java.** Read and write files through the fs plugin inside the project folder. `src/core` provides:
- `javaCompletions(source, offset)`: completion items with their imports
- `findOpModes(source)`: the OpMode list, as the Driver Station shows it
- `applyTunerOutput`: applies pasted AutoTune results to `Constants.java`

Check `ownershipOf` before editing generated files.

**Deploy.**
1. Connect the laptop to the robot's Wi-Fi.
2. Run `adbConnect(projectDir)`, then `gradle(projectDir, GRADLE_TASKS.deploy)`.

**Simulate.**
1. `startSimulator(projectDir)` resolves with `{ url, token, task }` once the real Java simulator accepts connections.
2. Create `new StreamClient({ url, token })` from `src/core` and send `init`, `start`, `gamepad`, and `stop`.
3. To finish, send `shutdown`; use `task.cancel()` only if it does not exit.
4. The first run downloads and compiles dependencies, so show progress from the Gradle output.

## Limits

- **Robot Wi-Fi:** building, deploying, and live robot data need the laptop on the robot's Wi-Fi. Nothing from the app can move a real robot; the robot stream accepts only `stop`.
- **Release builds:** they create projects only after the product has a public repository in `brand.ts`, because projects then use the published robot library. Development builds use the local `robot/` folder.
