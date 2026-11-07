# Visualizer compatibility check (development only)

Checks how Lumière's shipped `.pp` importer and exporter (`app/src/core/pp/visualizer.ts`, bundled
unchanged with the app's esbuild) handle the Pedro Pathing Visualizer's current file format. Nothing
here ships or edits the app.

```bash
node dev/visualizer-compat/check.mjs [--commit <upstream sha>]
```

- **Inputs:** the Visualizer's own test fixtures and the golden parse results its tests compare
  against, fetched at a pinned commit into `work/` (ignored by git). They are read as data and never
  executed or committed. Small synthetic files cover format 2.0.0 features that the fixtures leave out.
- **Import:** each fixture's start pose, segments (end points, control points, through points,
  headings, group headings), and run order (paths and waits) are compared with the Visualizer's
  golden parse. For paths drawn through points, the check evaluates the imported Bézier at each
  through point instead of comparing the two representations. A 2.0.0 fixture also checks that the
  app reports ignored robot settings and exports the project’s own robot dimensions.
- **Export:** each import is written back out. The check confirms the Visualizer's reader would
  accept the file (start point, lines, complete paths, a sequence that refers to existing paths) and
  that re-importing it gives the same geometry and order.

**Output levels:**

| Level | Meaning |
| --- | --- |
| `FAIL` | Throws, or writes a file the Visualizer would refuse |
| `DROP` | Data discarded without a warning |
| `DIFF` | Lumière's import disagrees with the Visualizer's own parse |
| `WARN` | The importer's warnings |

Only `FAIL` sets a nonzero exit code.

The pinned commit was `97104e0` (Visualizer format 2.0.0) on 2026-11-07. To compare with a newer
Visualizer, pass `--commit`.
