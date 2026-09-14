# Compatibility

Generated robot projects and the robot library are built and tested against these versions. The
pinned values live in [`quickstart/sources.json`](../quickstart/sources.json).

| Component | Version | Source |
| --- | --- | --- |
| FTC SDK (Robot Controller) | 12.0.0 (2026–27 season) | [FtcRobotController v12.0](https://github.com/FIRST-Tech-Challenge/FtcRobotController/releases/tag/v12.0) |
| Android Gradle Plugin / Gradle | 8.13.2 / 9.1.0 | Set by the FTC SDK |
| Pedro Pathing | 3.0.0 (`com.pedropathing:revhub`) | [Documentation](https://pedropathing.com/docs/pathing) |
| Pedro Pathing AutoTune | 1.0.0 (`com.pedropathing:tuning`) | Procedures pinned to Pedro Quickstart commit `b4312385` |
| Ivy | 1.1.1 (`com.pedropathing.ivy:core`, `:pedro`) | [Documentation](https://pedropathing.com/docs/ivy) |
| Panels | 1.0.12 (`com.bylazar:fullpanels`) | [Documentation](https://panels.bylazar.com) |
| Kotlin standard library | 2.4.10 (BOM) | Aligns versions pulled in by the libraries above |
| JDK for building | 17 or 21 | Android Studio's bundled JDK works |

## Build notes

- **compileSdk:** Panels depends on Material Components, which requires compileSdk 34. The FTC SDK compiles against API 30, so `TeamCode/libraries.gradle` raises only TeamCode's `compileSdkVersion` to 34. The SDK's own Gradle files are unchanged, and `minSdk` and `targetSdk` are unaffected.
- **Windows file locks:** an interrupted Gradle build on Windows can leave files locked by a background Gradle process or by security software, which shows up as "The process cannot access the file". Stopping Gradle (`gradlew --stop`) and building again resolves it. The FTC SDK 11.2.1 release notes describe the same behavior.

## Verification

| Check | How |
| --- | --- |
| Robot library and simulator unit tests, lint, release artifacts | `robot/`: `gradlew :ftc-lib:testDebugUnitTest :sim:testDebugUnitTest :ftc-lib:lintRelease :sim:lintRelease` |
| Generated project builds a Robot Controller APK (compile and dex) | CI job *Quickstart checks* |
| Example Auto parks at the expected pose in simulation | `ExampleAutoSimulationTest` in the generated project |
| Interactive simulator end to end | `node scripts/sim-smoke.mjs --project <project>` |

None of these checks can confirm behavior on a physical Control Hub. See the
[hardware checklist](hardware-checklist.md).

## Known upstream issues

### Pedro Pathing 3.0.0: linear heading turns backwards on straight lines

`Curve.pathCompletion(t)` defaults to `remainingDistance(t) / length()`, which is the fraction still
to travel rather than the fraction travelled. `Line` and `CompoundCurve` use that default;
`BezierCurve` overrides it correctly. As a result, every heading interpolator based on
`pathCompletion` runs backwards on straight lines and compound paths. That includes `Path.linear`,
`Interpolator.linear`, and piecewise interpolation. For example, `line(a, b).linear(a, b)` starts at
`b`'s heading and ends, and holds, at `a`'s heading.

- **Workaround:** use `Headings.linear(a, b)` from the robot library. It measures progress with `remainingDistance`, which is correct for every curve type. Generated code and the quickstart examples use it.
- **Detection:** `HeadingsTest.pedroLinearHeadingIsReversedOnLinesInThisVersion` fails when a Pedro Pathing update fixes the defect, as a reminder to review this note.
- **Also affected:** `Interpolator.longLinear`, `PiecewiseInterpolator`, and `Follower.completion()`, which counts down from 1 to 0 along a line. `parametricCompletion()` is correct.
- **Status:** reported upstream as [Pedro-Pathing/PedroPathing#176](https://github.com/Pedro-Pathing/PedroPathing/issues/176) on 2026-09-13; the maintainers are looking into it. The fix proposed there (`1 - remainingDistance(t) / length()`) was checked against the v3.0.0 source, and `Headings` gives the same results with or without it.
