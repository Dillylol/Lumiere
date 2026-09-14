import { mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function readBrand(directory = root) {
  const source = readFileSync(resolve(directory, "app/src/brand.ts"), "utf8");
  const match = source.match(/export const BRAND = (\{[\s\S]*?\}) as const;/);
  if (!match) throw new Error("BRAND must be a JSON-compatible object followed by 'as const'.");
  return JSON.parse(match[1]);
}

/** Returns all changes before writing, so --check and rename --dry-run are read-only. */
export function brandChanges(directory = root, brand = readBrand(directory)) {
  const changes = new Map();
  function update(file, transform) {
    const before = readFileSync(resolve(directory, file), "utf8");
    const after = transform(before);
    if (after !== before) changes.set(file, after);
  }
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
  const title = `${brand.name} · ${brand.tagline}`;
  const html = (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  update("app/src-tauri/tauri.conf.json", (text) => {
    const config = JSON.parse(text);
    config.productName = brand.name;
    config.identifier = brand.identifier;
    // An ASCII executable name keeps Linux packages and scripts happy when the product name has accents.
    config.mainBinaryName = brand.slug;
    config.app.windows[0].title = title;
    // A previously exposed signing key must not remain trusted by the app.
    delete config.plugins?.updater;
    if (brand.repository && brand.updaterPublicKey) {
      config.plugins ??= {};
      config.plugins.updater = {
        endpoints: [`https://github.com/${brand.repository.owner}/${brand.repository.name}/releases/latest/download/latest.json`],
        pubkey: brand.updaterPublicKey,
      };
    }
    return json(config);
  });
  update("app/package.json", (text) => json({ ...JSON.parse(text), name: brand.slug }));
  update("app/package-lock.json", (text) => {
    const lock = JSON.parse(text);
    lock.name = brand.slug;
    lock.packages[""].name = brand.slug;
    return json(lock);
  });
  update("app/index.html", (text) => text
    .replace(/<title>.*<\/title>/, () => `<title>${html(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, () => `<meta name="description" content="${html(brand.description)}" />`)
    .replace(/<meta name="theme-color" content="[^"]*" \/>/, () => `<meta name="theme-color" content="${brand.themeColor}" />`));
  update("LICENSE", (text) => text.replace(/Copyright \(c\) (\d+), The .* Contributors/, (_, year) => `Copyright (c) ${year}, The ${brand.name} Contributors`));
  update("README.md", (text) => text.replace(/^# .*$/m, () => `# ${brand.name}`));
  update("app/src-tauri/Cargo.toml", (text) => text.replace(/^authors = .*$/m, () => `authors = [${JSON.stringify(`The ${brand.name} Contributors`)}]`));
  return changes;
}

/** Writes each changed file. A null value deletes the file and any folders it leaves empty. */
export function writeChanges(changes, directory = root) {
  for (const [file, content] of changes) {
    const base = resolve(directory);
    const target = resolve(base, file);
    if (content === null) {
      rmSync(target, { force: true });
      for (let folder = dirname(target); folder.startsWith(base) && folder !== base; folder = dirname(folder)) {
        if (readdirSync(folder).length) break;
        rmdirSync(folder);
      }
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check")) throw new Error("Usage: node scripts/brand.mjs [--check]");
  const changes = brandChanges();
  if (args.includes("--check") && changes.size) {
    console.error(`Brand values are stale: ${[...changes.keys()].join(", ")}. Run npm run brand in app/.`);
    process.exitCode = 1;
  } else if (!args.includes("--check")) writeChanges(changes);
}
