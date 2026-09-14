# Core

Program logic for the app, with no React or Tauri imports. UI code imports from `src/core` (the
barrel file `index.ts`). Every module has tests; run `npm test`.

| Module | Purpose |
| --- | --- |
| `ir/types.ts` | Project format version 2: robot profile, mechanisms, autonomous and TeleOp programs |
| `ir/schema.ts` | `parseProject` and `safeParseProject` check stored or imported JSON |
| `ir/create.ts` | Factories for new projects, programs, paths, mechanisms, and ids |
| `ir/validate.ts` | `validateProject` returns problems anchored to a program, path, step, mechanism, or binding |
| `ir/migrate.ts` | `migrateVersion1` converts projects saved by the earlier text-command editor |
| `geometry/` | Lines, Bezier curves, compound paths, and headings with the same math as Pedro Pathing and the robot library |
| `preview/timeline.ts` | `buildTimeline` gives a kinematic preview of an autonomous routine for the web |
| `pp/visualizer.ts` | Import and export Pedro Pathing Visualizer `.pp` files |
| `codegen/java/` | `generateJava` produces the robot project's Java, in a chosen package and with a chosen constants class; `planWrites` protects hand-edited files |
| `sdk/` | `inspectFtcProject` checks an existing FTC SDK project (version, libraries, constants classes, OpModes); `planDeploy` plans writes and safe removals for deploying into it ([guide](../../../docs/connect-ftc-sdk.md)) |
| `java/buildOutput.ts` | `parseBuildOutput` turns Gradle and javac output into problems with file, line, and column |
| `java/opModes.ts` | `findOpModes` lists the `@Autonomous` and `@TeleOp` classes in a Java file with the names the Driver Station shows |
| `java/tuning.ts` | `applyTunerOutput` puts pasted AutoTune results into `Constants.java` (imports and localizer changes included); `updateTuningLocalizer` updates `Tuning.java` |
| `javaHints/` | `javaCompletions` completes FTC SDK, Pedro Pathing, Ivy, Panels, and robot-library members from hand-written hints that CI checks against the real libraries |
| `protocol/` | Message types and `StreamClient` for the robot and desktop simulator ([protocol](../../../docs/protocol.md)) |

## Coordinates and units

- **Field frame:** Pedro Pathing field coordinates. Inches from the bottom-left corner, 0 to 144 on both axes, heading 0 along +x, counterclockwise positive.
- **Stored angles:** the project stores headings in degrees.
- **Computed angles:** geometry functions and stream messages use radians.

## Typical flows

**Editing.** Change the project, call `validateProject`, and show each problem next to the part of the
program it names. Generation refuses projects with errors, so validation runs first.

**Previewing on the web.** Call `buildTimeline(program, project)`. Then draw
`timeline.poseAt(ms)`, the paths from `resolveProgramPaths(program)`, and
`timeline.mechanismStates(ms)`. Label the result as a preview; the desktop simulator runs the real
code.

**Deploying Java into an FTC SDK project.**

1. Read the build files in `INSPECTED_FILES` and every `.java` file under `INSPECTED_JAVA_ROOT`, then call `inspectFtcProject`.
2. Call `planDeploy(project, settings, existing, previousPaths, overwrite, inspection)`.
3. Write the `create` and `update` entries and delete `removals`.
4. Store `generatedPaths` as the next `previousPaths`.
5. Ask the user about `conflict` entries, which are generated files that were edited by hand. Pass the ones they choose to overwrite as `overwrite`.
6. Never write `skip` entries: those files belong to the team.

The desktop app does this in `app/src/desktop/ftcFolder.ts` and `app/src/studio/useDesktop.ts`.

**Applying AutoTune results.**
1. Pass `Constants.java` and the pasted text to `applyTunerOutput`.
2. Show `result.source` as a diff, with `result.notes` and any `missing` fields.
3. If `result.localizerChange` is set, also call `updateTuningLocalizer` on `Tuning.java`.
4. Offer `setTuned(source, true)` once the Mecanum, localizer, and Foresight blocks are tuned.

**Talking to a robot or the simulator.** Create a
`new StreamClient({ url, token })`, call `connect()`, and subscribe with `onMessage`.
`findRobot()` checks the standard Robot Controller addresses. Use `fromBrowserGamepad` to map the
Web Gamepad API to FTC gamepad fields.

## Parity with the robot

- **Geometry:** `fixtures/parity/` holds path cases built with the real Pedro Pathing library in `robot/ftc-lib`. The geometry tests must match them within 1e-6.
- **Generated code:** golden files in `fixtures/golden/` compile against the FTC SDK in CI, and the generated OpModes run in the simulator there.
