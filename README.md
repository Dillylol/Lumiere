# Lumière

An offline-first studio for building, simulating, and deploying FTC robot programs.
Product naming lives in [`app/src/brand.ts`](app/src/brand.ts), while stable install and project identifiers remain unchanged across future display-name updates.

Version 0.1.1 is released. The workspace, robot library, desktop simulator, quickstart generator, Java generation, and desktop backend are implemented and verified without hardware. See [release progress](docs/release-progress.md) and the [hardware checklist](docs/hardware-checklist.md).

## Repository layout

| Path | Contents |
| --- | --- |
| `app/` | Desktop and web app (React, Vite, Tauri) |
| `app/src/core/` | Framework-free program logic: project format, geometry, Java generation, stream client ([guide](app/src/core/README.md)) |
| `app/src/desktop/` | Frontend access to the desktop backend ([guide](app/src/desktop/README.md)) |
| `app/src-tauri/` | Desktop backend: build-tool setup, project creation, Gradle and adb runner |
| `robot/` | Robot library (`ftc-lib`) and desktop simulator (`sim`), built with Gradle |
| `quickstart/` | Pinned upstream sources and the overlay layered onto the official FTC SDK to create a robot project |
| `fixtures/` | Shared test fixtures: sample projects, golden Java, parity cases, build output |
| `scripts/` | Quickstart generator, simulator smoke test, branding and rename tools |
| `docs/` | Protocol, compatibility, simulator, [connecting an FTC SDK project](docs/connect-ftc-sdk.md), and hardware checklist |

## Development

```bash
cd app
npm ci
npm run dev        # web app at http://localhost:1420
npm test           # unit tests
npm run tauri dev  # desktop app
```

Robot library and simulator (JDK 17 to 21 and the Android SDK):

```bash
cd robot
./gradlew :ftc-lib:testDebugUnitTest :sim:testDebugUnitTest
```

Generate a robot project that uses this checkout's robot library, then run it in the simulator:

```bash
node scripts/quickstart.mjs --out ../robot-project --robot-library local
node scripts/sim-smoke.mjs --project ../robot-project
```

Rename the product (dry run first):

```bash
node scripts/rename.mjs --name "New Name" --dry-run
```

## License

BSD 3-Clause. See [LICENSE](LICENSE).
