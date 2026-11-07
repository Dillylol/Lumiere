# Pedro Pathing Visualizer in Lumière

Open **Paths → Visualizer** to edit an autonomous path with Pedro Pathing Visualizer. **Load selected program** opens the current autonomous program, and **Open .pp** opens a saved draft. **Apply & test** validates the draft, updates the selected program, and opens Simulate. You can undo the update in the workbench. Programs with mechanism steps or parallel actions need a separate path-only copy for this workflow. **Save .pp** downloads the Visualizer document. The draft stays open as you switch tabs.

The desktop simulator compiles the linked FTC SDK project and runs its real Java. It uses the program's starting pose and the project footprint by default. Under **Robot model**, you can supply an existing simulator JSON with wheel geometry, motor RPM and battery voltage. The web preview shows idealized path timing. The **Run comparison** uses measured simulator and robot runs, with generated routine timings kept separate from older START-to-STOP timings. Deploy the APK from **Robot** when ready and start the OpMode from the Driver Station.

Lumière can represent paths and path timing from the `.pp` format. Visualizer-specific overlays and obstacles can stay in a `.pp` file, so keep that file if you use them. The embedded editor runs offline and the upstream online optimizer is disabled. The upstream editor requires a desktop browser or the desktop app.

## Source and packaging

The bundled build is based on the supplied [Pedro Pathing Visualizer](https://github.com/Pedro-Pathing/Visualizer) source archive, which reads and writes `.pp` format `2.0.0`. `app/public/pedro-visualizer/SOURCE.sha256` fingerprints the build input tree. The archive did not include Git revision metadata.

The [Apache 2.0 license](../app/public/pedro-visualizer/LICENSE), [upstream NOTICE](../app/public/pedro-visualizer/NOTICE), and bundled dependency licenses travel with the build. The source modifications are in `scripts/vendor-visualizer.mjs`, `scripts/visualizer-bridge.ts`, and `scripts/visualizer-theme.css`. They adapt asset paths and panel defaults, disable the standalone service worker and online optimizer, apply Lumière's theme, and add the `.pp` message bridge.

To rebuild, install the pinned dependencies in the upstream checkout with its lockfile. Then run from the Lumière repository root:

```sh
node scripts/vendor-visualizer.mjs path/to/installed/Visualizer
```

The script patches a temporary copy, reports the source fingerprint, and updates `app/public/pedro-visualizer`. Normal Lumière builds use the checked-in assets directly. The web build precaches them for offline use and the desktop build bundles them locally.

The iframe loads only packaged code. Its message bridge checks the sending window and origin and accepts readiness, load, and save messages. The child document inherits the app's security policy via `srcdoc`, so Tauri can keep its `frame-ancestors 'none'` policy on served HTML files.
