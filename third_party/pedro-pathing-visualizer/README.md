# Pedro Pathing Visualizer

The Lumière Pathing Visualizer is based on the [Pedro Pathing Visualizer](https://github.com/Pedro-Pathing/Visualizer), licensed under the [Apache License 2.0](LICENSE). Its [NOTICE](NOTICE) credits Matthew Allen, whose earlier work it includes. Lumière is not affiliated with or endorsed by Pedro Pathing.

Lumière rebuilt the Visualizer's screens in React on its own project model. These files adapt the Visualizer's code, and each one says so in its header:

| Lumière file | Adapted from | Changes |
| --- | --- | --- |
| `app/src/core/pathing/mirror.ts` | `src/model/mirror.ts` | Works on Lumière programs and normalizes mirrored angles. Mirrors across x = 70.75, as the Visualizer does |
| `app/src/core/pathing/field.ts` | `src/config/defaults.ts`, `src/view/snap.ts` | The 141.5-inch floor, the picture's 1.25-inch overhang, and grid snapping spaced from the tile seams, as plain functions |
| `app/src/core/pathing/pen.ts` | `src/lib/pen/strokeFitting.ts` | Fits a pen stroke into one Lumière path, writing its through points as the Bezier control points of the same curve |

These files are copied unchanged from the Visualizer's `public/fields/` folder:

| Lumière file | Shows |
| --- | --- |
| `app/public/pathing/fields/biobuzz-dark.webp`, `biobuzz-light.webp` | The BIOBUZZ (2026–2027) field |
| `app/public/pathing/fields/decode.webp` | The DECODE (2025–2026) field |
| `app/public/pathing/fields/intothedeep.webp` | The INTO THE DEEP (2024–2025) field |
| `app/public/pathing/fields/centerstage.webp` | The CENTERSTAGE (2023–2024) field |

The rest of the Pathing workspace (`app/src/studio/pathing/`) is new code. It follows the Visualizer's layout: a top bar with File and Export menus, a Layers panel, a field card with a tool rail on each side and a playback bar, and an Inspector. It also reuses the Visualizer's design ideas, such as dragging a whole edit as one undo step, timing playback, measuring with a ruler and protractor, and mirroring for the other alliance.

The app ships this LICENSE and NOTICE at `licenses/pedro-pathing-visualizer/`. The workspace shows "Based on the Pedro Pathing Visualizer" under its name, and the Learn page credits the Visualizer.
