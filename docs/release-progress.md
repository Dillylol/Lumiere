# Release progress

Updated 2026-09-14. This record separates what has been verified locally from what still waits on hardware,
continuous integration, or release decisions. Version 0.1.1 is released at github.com/Dillylol/Lumiere, with the robot library on JitPack.

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
| P7 Release | 0.1.1 released | Named Lumière, repository `Dillylol/Lumiere`. The tag workflow builds installers for Windows, universal macOS, and Linux; JitPack builds the robot library. Auto-update and code signing are not set up yet. |

## Verification record

Local checks on Windows 11:

| Check | Result |
| --- | --- |
| Robot library and simulator (`robot/`) | 43 JUnit tests pass (25 `ftc-lib`, 18 `sim`), plus lint |
| Core TypeScript (`app/src/core`) | 68 Vitest tests pass, including Pedro parity within 1e-6 and golden Java output |
| Desktop bridge (`app/src/desktop`) | 6 Vitest tests pass against Tauri's IPC mock |
| Rust backend | 28 tests pass; `cargo fmt --check` and `clippy -D warnings` are clean |
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
| Script tests | 4 Node tests pass (brand sync, rename, accented names, and injection) |
| Browser workflows | Playwright at 1366×768 and 820×600: create from templates, edit routines (add, reorder, undo), drag and nudge waypoints, edit path headings and curves, generated Java, preview play and reset, command palette, export, reload persistence, TeleOp bindings with mechanisms, program delete and undo, settings, help, and import. No serious axe findings, no console errors, no sideways scrolling, and the whole field stays visible. |
| Windows installers | `npm run tauri build` produces `Lumière_0.1.1_x64_en-US.msi` and `Lumière_0.1.1_x64-setup.exe` (unsigned) around `lumiere.exe`. The MSI's product name keeps its accent, and so does the release app's window title. |
| GitHub CI | App, desktop (Windows, macOS, Linux), robot library, and quickstart workflows pass on `9f07db9`. |
| Release 0.1.1 | The tag workflow built all seven installers. JitPack built `ftc-lib` and `sim`, and a release-mode project using them from JitPack builds its APK and passes its simulation test. The Windows installer downloads without signing in. |
| Desktop release app | Driven over WebView2's DevTools protocol: loads, detects tools, saves projects to app data, renders Monaco under the production CSP, runs a Gradle check through the backend, and starts the simulator. The webview connects and Example Auto parks at (35.99, 23.98). No console errors. |

Not yet verified:
- **Other platforms:** CI builds and tests pass on macOS and Linux, but nobody has installed and used the app there yet.
- **Hardware:** see the [hardware checklist](hardware-checklist.md).
- **Native dialogs:** folder and save pickers need a person; the desktop smoke test covers everything around them.
- **Unused code:** the previous UI (`App.tsx` and `components/`) is no longer rendered and can be removed once the new workspace settles.

## Decisions made during implementation

- **Android command-line tools 19.0:** version 22.0 deprecates `sdkmanager`, and 23.0 routes it through a new "Android CLI". That CLI downloads further unpinned binaries and enables usage metrics by default. In testing it also ignored `--sdk_root` and installed into the home folder instead.
- **Temurin 21:** it matches the JDK used in CI. Builds accept an existing Java 17 through 21, preferring Android Studio's bundled JDK.
- **Port 0 for the simulator:** it binds a free port and reports it, which avoids a race and a backend helper.
- **Pedro Pathing 3.0.0 heading defect:** linear headings run backwards on lines. Generated code works around it with `Headings`; details are in [compatibility](compatibility.md). It is reported upstream as Pedro-Pathing/PedroPathing#176.
- **Windows test binaries:** they embed the Common Controls manifest so Tauri's IPC tests can start.
- **No service worker in the desktop app:** only web builds include the offline service worker. In the desktop webview it kept serving the previous build's files after an update; Tauri builds now leave it out (`TAURI_ENV_PLATFORM` in `vite.config.ts`). A release app created a project, saved it as a `.lum` file, and listed it again after a reload.
- **Dropped from the original plan:** golden Java is compiled with the FTC SDK's normal settings, not with warnings as errors, because the SDK's Java 8 target itself triggers javac option warnings. Property-based tests were not added; fixture and parity tests cover the geometry.

## Before the next release

- **Auto-update:** the app has no updater yet, so 0.1.1 users update by downloading again. Adding it means registering the updater plugin, an update check in the app, and a new signing key in the repository's secrets. The previously exposed key is retired: its CI secrets were deleted from the old repository and no Lumière build trusts it.
- **Robot library:** release builds create projects that use `com.github.Dillylol.Lumiere:ftc-lib:v<version>` from JitPack, where `<version>` is the app version, so every release needs its matching tag. Development builds keep using the local `robot/` folder.
- **Stable identifiers:** the app identifier is `dev.lumiere.desktop`, and the MSI upgrade code is pinned in `tauri.conf.json`. Neither may change after the first public release: installed copies would lose their app data, and Windows would install a second copy instead of upgrading. `rename.mjs` leaves both alone, along with the `studio` storage namespace and the `.lum` project file extension.
- **Signing:** decide on code-signing certificates for Windows and macOS.
- **Publication:** creating the quickstart repository, new tags and releases, and web hosting each wait for explicit approval.
