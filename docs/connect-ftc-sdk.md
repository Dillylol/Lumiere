# Connecting your FTC SDK project

The desktop app can keep the Java for your programs up to date inside the FtcRobotController project you
already build in Android Studio. You keep building and installing on the robot the way you do now; the
app only removes the step of saving generated files and copying them into TeamCode.

## Connect

1. Open a project and go to **Robot**.
2. Choose **Connect FTC SDK project** and pick your FtcRobotController folder (the one with `TeamCode`
   and `gradlew`). Or choose **Create a new one** for a fresh project from the official FTC SDK.
3. The app checks the folder. It lists:
   - **FTC SDK version:** generated code is built and tested with FTC SDK 12.0.0.
   - **Libraries:** Pedro Pathing 3, Ivy, and this app's robot library.
   - **Pedro Pathing constants:** a class with `static Follower create(HardwareMap)`, as in the Pedro Pathing quickstart.
   - **Pedro Pathing 2:** it is flagged if present, because its API does not match generated code.
4. If something is missing, choose **Add what is missing**. The app adds:
   - `TeamCode/libraries.gradle` and one `apply from` line at the end of `TeamCode/build.gradle`
   - `simulation/RunSimulator.java` under `TeamCode/src/test`, so the desktop simulator can run your code
   - optionally, when your project has no constants class: `pedro/Constants.java`, `pedro/Tuning.java`, and the AutoTune procedures

   Files that already exist are never replaced. Afterwards, sync Gradle in Android Studio.

The folder path is remembered on this computer only. It is not saved in exported `.lum` project files.

## Choose how deploys work

| Setting | What it does |
| --- | --- |
| **Java package** | Where the classes go. The default is `org.firstinspires.ftc.teamcode.generated.<project>`. Changing it moves the generated files. |
| **Pedro Pathing constants class** | The class generated OpModes call `create(hardwareMap)` on. Every matching class in TeamCode is offered. |
| **When to deploy** | **Automatically after each change**: shortly after you stop editing. Or **Only when I press Deploy code**. |
| **Programs to deploy** | All programs, or only the ones you pick. |
| **Remove generated files this project no longer makes** | Cleans up after renamed or deleted programs and package changes. |

Automatic deploys wait while:
- the project has problems
- the FTC SDK project is missing libraries
- the chosen constants class is missing

The header shows the current deploy status next to **Saved**.

## What the app will and will not touch

- **Generated files:** every generated file starts with a `// GENERATED FILE` header and a checksum.
  The app only updates or removes a generated file whose contents still match that checksum.
- **Edited generated files:** if you edit a generated file, the app stops updating it and lists it under
  **Edited generated files**. There you can overwrite it with the current program, or delete its header
  to keep your version for good.
- **Your own files:** files without the header belong to your team and are never changed. If one has the
  same path as a generated class, the app reports it instead of writing.
- **Folders:** the app only writes inside the generated package folder. The one exception is **Add what
  is missing**, which adds the files listed above.
- **Duplicate OpMode names:** if your code already has an OpMode with the same name as a generated one,
  the app warns you, because the Driver Station would show both.
- **Atomic writes:** each file is written to a temporary name and then renamed, so Android Studio never
  compiles a half-written file.

## Build and install

Build and install from Android Studio as usual, or use **Check** and **Build APK** in the app. Those actions
deploy first, and they stop if a generated file needs your decision.

## Release builds

Connected projects use the published robot library. Until the app has a public release, only development
builds can add it (they use this repository's `robot/` folder).
