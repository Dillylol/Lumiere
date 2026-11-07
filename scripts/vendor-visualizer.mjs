import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const sourceArg = process.argv[2];
if (!sourceArg) throw new Error("Usage: node scripts/vendor-visualizer.mjs <installed Visualizer source directory>");
const source = resolve(sourceArg);
const output = fileURLToPath(new URL("../app/public/pedro-visualizer", import.meta.url));
const scratchRoot = resolve(tmpdir());
const scratch = mkdtempSync(join(scratchRoot, "lumiere-visualizer-"));

const files = ["LICENSE", "NOTICE", "index.html", "package.json", "pnpm-lock.yaml", "postcss.config.js", "svelte.config.js", "tsconfig.json", "tsconfig.node.json", "vite.config.ts", "public", "src"];

function fingerprint(dir, paths) {
  const hash = createHash("sha256");
  function add(path) {
    const full = join(dir, path);
    if (statSync(full).isDirectory()) {
      for (const name of readdirSync(full).sort()) add(path + "/" + name);
      return;
    }
    const bytes = readFileSync(full);
    hash.update(`${path}\0${bytes.length}\0`).update(bytes);
  }
  for (const path of paths) add(path);
  return hash.digest("hex");
}

function patch(path, original, replacement) {
  const file = join(scratch, path);
  const text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  if (text.split(original).length !== 2) throw new Error(`Unexpected upstream source in ${path}`);
  writeFileSync(file, text.replace(original, () => replacement));
}

function substituteAssets(path) {
  const file = join(scratch, "src", path);
  const text = readFileSync(file, "utf8");
  writeFileSync(file, text.replace(/\/(fields\/|robot\.png|JefferyThePotato\.png|MecanumDuck\.png|gif\.worker\.js|logo-duck\.svg|loading\.svg)/g, "$1"));
}

try {
  const digest = fingerprint(source, files);
  for (const name of files) cpSync(join(source, name), join(scratch, name), { recursive: true });
  symlinkSync(join(source, "node_modules"), join(scratch, "node_modules"), process.platform === "win32" ? "junction" : "dir");

  // The parent app owns offline caching.
  const main = readFileSync(join(scratch, "src/main.ts"), "utf8");
  const workerStart = main.indexOf("// Register the service worker");
  if (workerStart < 0) throw new Error("Unexpected upstream service worker setup");
  writeFileSync(join(scratch, "src/main.ts"), main.slice(0, workerStart) + "export default app;\n");
  for (const name of ["index.html", "sw.js", "manifest.webmanifest"]) rmSync(join(scratch, "public", name));
  patch("index.html", '    <link rel="manifest" href="/manifest.webmanifest" />\n', "");

  for (const path of [
    "config/defaults.ts", "lib/export/gifExport.ts", "lib/components/FieldMapImage.svelte",
    "lib/components/FieldLoadingOverlay.svelte", "view/fieldMap.ts", "state/gifExport.svelte.ts",
    "view/FieldPanel.svelte", "utils/gifExporter.ts", "lib/components/RobotSprite.svelte",
    "lib/components/settings/RobotImagePicker.svelte", "view/TopBar.svelte",
  ]) substituteAssets(path);
  patch("src/view/FieldPanel.svelte", 'settings.robotImage || "robot.png"', 'settings.robotImage?.replace(/^\\/(?=(robot|MecanumDuck|JefferyThePotato)\\.png$)/, "") || "robot.png"');

  patch("src/state/theme.svelte.ts", 'const STORAGE_KEY = "theme";', 'const STORAGE_KEY = "lumiere-pedro-theme";');
  patch("src/state/theme.svelte.ts", 'function storedChoice(): ThemeChoice {', `function storedChoice(): ThemeChoice {
  const hostTheme = document.documentElement.dataset.lumiereTheme;
  if (hostTheme) return hostTheme === "light" ? "light" : "dark";`);
  patch("src/App.svelte", '  import { Theme } from "./state/theme.svelte";', '  import { Theme } from "./state/theme.svelte";\n  import { installLumiereBridge } from "./lumiere-embed";');
  patch("src/App.svelte", `  onMount(async () => {
    await prefs.load();
    files.start();
    layout.restore(prefs.value);
  });`, `  onMount(() => {
    let mounted = true;
    let removeBridge = () => {};
    void prefs.load().then(() => {
      if (!mounted) return;
      files.start();
      layout.rightHidden = innerWidth < 950;
      layout.restore(prefs.value);
      removeBridge = installLumiereBridge(files, isMobileBlocked);
    });
    return () => {
      mounted = false;
      removeBridge();
    };
  });`);
  patch("src/lib/optimizer/optimizer.ts", '  const response = await fetch(`${OPTIMIZER_BASE_URL}`, {', `  if (window.parent !== window) throw new Error("The online optimizer is unavailable in the embedded Visualizer.");
  const response = await fetch(OPTIMIZER_BASE_URL, {`);
  writeFileSync(join(scratch, "src/lumiere-embed.ts"), readFileSync(new URL("./visualizer-bridge.ts", import.meta.url)));
  writeFileSync(join(scratch, "src/app.css"), readFileSync(join(scratch, "src/app.css"), "utf8") + "\n" + readFileSync(new URL("./visualizer-theme.css", import.meta.url), "utf8"));
  patch("vite.config.ts", '    outDir: "dist",', `    outDir: "dist",
    license: { fileName: "THIRD_PARTY_LICENSES.md" },
    rolldownOptions: {
      output: {
        entryFileNames: "assets/editor.js",
        assetFileNames: ({ names }) => names.some((name) => name.endsWith(".css"))
          ? "assets/editor.css" : "assets/[name]-[hash][extname]",
      },
    },`);

  const result = spawnSync(process.execPath, [join(scratch, "node_modules/vite/bin/vite.js"), "build"], { cwd: scratch, stdio: "inherit" });
  if (result.error || result.status !== 0) throw result.error ?? new Error("Visualizer build failed");
  const built = join(scratch, "dist");
  for (const name of ["assets/editor.js", "assets/editor.css", "THIRD_PARTY_LICENSES.md"]) statSync(join(built, name));
  for (const name of ["editor.js", "editor.css"]) {
    const asset = join(built, "assets", name);
    writeFileSync(asset, `/*! Pedro Pathing Visualizer. Modified for Lumière's embedded editor. See LICENSE and NOTICE. */\n${readFileSync(asset, "utf8")}`);
  }
  const gifLicense = readFileSync(join(source, "node_modules/gif.js/README.md"), "utf8").split("## License")[1]?.trim();
  if (!gifLicense?.startsWith("The MIT License (MIT)")) throw new Error("Could not locate the GIF worker license");
  rmSync(join(built, "index.html"));
  mkdirSync(output, { recursive: true });
  // Remove the previous generated files without recursing outside the destination.
  const assets = join(output, "assets");
  if (existsSync(assets)) for (const name of readdirSync(assets)) rmSync(join(assets, name));
  cpSync(built, output, { recursive: true });
  for (const name of ["LICENSE", "NOTICE"]) cpSync(join(source, name), join(output, name));
  writeFileSync(join(output, "GIF_WORKER_LICENSE"), `${gifLicense}\n`);
  writeFileSync(join(output, "SOURCE.sha256"), `${digest}\n`);
  console.log(`Visualizer source SHA-256: ${digest}`);
} finally {
  const path = relative(scratchRoot, scratch);
  if (path.startsWith("lumiere-visualizer-") && !path.includes(sep)) rmSync(scratch, { recursive: true, force: true });
}
