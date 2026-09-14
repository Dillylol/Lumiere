# Production roadmap

The production release plan supersedes the earlier prototype roadmap. The current implementation and verification record is in [release progress](docs/release-progress.md).

## Product direction

- An offline web authoring app and a desktop app with on-demand Java build tools.
- A real Java editor, ordinary FTC SDK 12.0 / Pedro 3 / Ivy / Panels source, and a small robot library.
- Real Java simulation on the desktop JVM; a clearly labeled TypeScript kinematic preview on the web.
- A read-only robot WebSocket stream with stop as its only accepted control. Real OpModes start from the Driver Station.
- No Python relay, AI integration, account requirement, analytics, vendored third-party code, or season-specific content.
- One product-name source, stable project identifiers, and the .lum project file extension. Legacy .jules import remains supported.

## Ordered release phases

| Phase | Work | Exit gate | Status |
| --- | --- | --- | --- |
| P0 | Archive and cleanup; app directory, branding, rename tools, baseline CI | App tests and build; Rust format/clippy/tests; clean tracked-file audit | Done |
| P1 | FTC 12.0 + Pedro 3 + Ivy + Panels dependency spike; JVM feasibility | Official quickstart dex build; real follower completes 48 inches; lifecycle, gamepad, Ivy and Panels checks | Done |
| P2 | Project v2 schema and migration; geometry, .pp round trip, shared stream protocol | Synthetic fixtures, .pp round trip, real Pedro geometry parity | Done |
| P3 | Tiny robot library and desktop JVM simulator | Unit tests, Android lint, stream lifecycle and physics checks | Done |
| P4 | Compilable Java generation and official-SDK quickstart overlay | Golden source compiles against FTC SDK 12.0 and the libraries; simulated autos meet target tolerances | Done |
| P5 | Home, blocks, paths, bindings, preview, robot status, learning, undo and recovery | Browser workflows, keyboard access and accessibility checks | In progress |
| P6 | Java editor, tool installer, build/deploy and JVM runner | Build errors become editor markers; desktop quickstart smoke test | Backend done; editor UI pending |
| P7 | Cross-platform installers, update signing, docs and release workflows | All release checks pass and publication gates are satisfied | Not started |

The legacy text DSL is retired: `migrateVersion1` converts saved version 1 projects into project v2. The previous proposal to vendor a visualizer or build a Rust/WASM simulation kernel is retired.

## Publication gates

Ask before pushing branches, creating or pushing the quickstart repository, tagging or publishing a release, or hosting the web app. The public name must be final before the first tag and JitPack coordinates. The exposed updater key must be rotated and CI secrets replaced before updates are enabled. Hardware verification remains a separate documented checklist.
