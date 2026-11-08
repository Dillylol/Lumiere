# Pedro Pathing Visualizer

The Lumière Pathing Visualizer is based on the [Pedro Pathing Visualizer](https://github.com/Pedro-Pathing/Visualizer), licensed under the [Apache License 2.0](LICENSE). Its [NOTICE](NOTICE) credits Matthew Allen, whose earlier work it includes. Lumière is not affiliated with or endorsed by Pedro Pathing.

Lumière rebuilt the Visualizer's screens in React on its own project model. These files adapt the Visualizer's code, and each one says so in its header:

| Lumière file | Adapted from | Changes |
| --- | --- | --- |
| `app/src/core/pathing/mirror.ts` | `src/model/mirror.ts` | Works on Lumière programs, normalizes mirrored angles, and mirrors across x = 72 |

The rest of the Pathing workspace is new code. It reuses the Visualizer's design ideas, such as dragging a whole edit as one undo step, timing playback, and mirroring for the other alliance.

The app ships this LICENSE and NOTICE at `licenses/pedro-pathing-visualizer/`, and the Learn page credits the Visualizer.
