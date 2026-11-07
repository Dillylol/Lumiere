# Compatibility

Generated robot projects and the robot library are built and tested against these versions. The
pinned values live in [`quickstart/sources.json`](../quickstart/sources.json).

| Component | Version | Source |
| --- | --- | --- |
| FTC SDK (Robot Controller) | 12.0.0 (2026–27 season) | [FtcRobotController v12.0](https://github.com/FIRST-Tech-Challenge/FtcRobotController/releases/tag/v12.0) |
| Android Gradle Plugin / Gradle | 8.13.2 / 9.1.0 | Set by the FTC SDK |
| Pedro Pathing | 3.0.2 (`com.pedropathing:revhub`) | [Pedro Pathing v3.0.2](https://github.com/Pedro-Pathing/PedroPathing/releases/tag/v3.0.2) |
| Pedro Pathing AutoTune | 1.0.3 (`com.pedropathing:tuning`) | [Maven Central](https://repo.maven.apache.org/maven2/com/pedropathing/tuning/maven-metadata.xml) with procedures pinned to [Pedro Quickstart commit `4f33ef5b`](https://github.com/Pedro-Pathing/Quickstart/tree/4f33ef5bbbd99ebfe978f0b86046ca43469e2df2) |
| Ivy | 1.1.1 (`com.pedropathing.ivy:core`, `:pedro`) | [Documentation](https://pedropathing.com/docs/ivy) |
| Panels | 1.0.20 (`com.bylazar:fullpanels`) | [Panels Maven repository](https://mymaven.bylazar.com/releases/com/bylazar/fullpanels/1.0.20/fullpanels-1.0.20.pom) |
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

- **Also affected:** `Interpolator.longLinear`, `PiecewiseInterpolator`, and `Follower.completion()`, which counts down from 1 to 0 along a line. `parametricCompletion()` is correct.
- **Status:** reported upstream as [Pedro-Pathing/PedroPathing#176](https://github.com/Pedro-Pathing/PedroPathing/issues/176) on 2026-09-13, and fixed in 3.0.1 (released 2026-09-18).

### Pedro Pathing 3.0.2: heading interpolators receive progress instead of the curve parameter

From 3.0.2, `AtomicPath` and `CompoundPath` pass an interpolator the fraction of distance travelled,
unless the interpolator's new `isGeometric()` method returns true; tangent, facing-point, and
piecewise interpolators are marked geometric and still receive the curve parameter. This matters on
curves, where progress and the parameter differ.

- **Robot library:** every `Headings` interpolator reports itself geometric and measures distance
  itself, so it gives the same headings on 3.0.0, 3.0.1, and 3.0.2. Earlier builds of the library
  converted progress twice on 3.0.2: on a test curve, `Headings.linear` lagged by up to 9.9° and a
  `Headings.piecewise` facing-point rule aimed up to 20.4° off between the ends.
- **Upstream defect in 3.0.2:** `Interpolator.reverse()` still returns a plain lambda, which 3.0.2
  treats as not geometric. `Path.reverseTangent()` therefore evaluates the tangent at the wrong point
  on curves: up to 13.9° off on the same test curve, with no error on 3.0.0 and none on straight
  lines. Generated code uses a full-length reversed tangent segment from `Headings.piecewise()`,
  which keeps the interpolator geometric and uses the same API as earlier robot-library releases.
  `HeadingsTest.reverseTangentUsesTheCurveParameter` checks it at several points on a curve.
- **Detection:** `dev/virtual-hardware/virtual-hub.mjs --probe --pedro <version>` prints every case
  for a given Pedro Pathing version.
