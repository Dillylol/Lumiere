// Renames the product in one pass: branding, Java packages of the robot library and simulator (including
// source folders), and the generated golden files. Saved-project storage and the desktop identifier keep
// their values so existing users are unaffected.
//
// Usage: node scripts/rename.mjs --name "New Name" --dry-run|--apply
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { brandChanges, readBrand, root, writeChanges } from "./brand.mjs";

/** Folders whose Java packages follow the brand. The quickstart overlay uses template tokens instead. */
const JAVA_ROOTS = ["robot", "fixtures/golden-tests"];
const SKIPPED_FOLDERS = new Set(["build", ".gradle", ".idea", ".cxx"]);
const TEXT_EXTENSIONS = new Set([".java", ".kt", ".gradle", ".kts", ".pro", ".properties", ".md", ".json", ".xml", ".txt"]);

function listFiles(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return SKIPPED_FOLDERS.has(entry.name) ? [] : listFiles(path);
    return [path];
  });
}

/** Rewrites package names in file contents and moves files whose folders spell a renamed package. */
export function javaPackageChanges(directory, from, to) {
  const changes = new Map();
  const renames = [[from.package, to.package], [from.simPackage, to.simPackage]].filter(([before, after]) => before !== after);
  if (!renames.length) return changes;
  const folders = renames.map(([before, after]) => [`/${before.replaceAll(".", "/")}/`, `/${after.replaceAll(".", "/")}/`]);
  for (const base of JAVA_ROOTS) {
    for (const file of listFiles(resolve(directory, base))) {
      const path = relative(directory, file).split(sep).join("/");
      const newPath = folders.reduce((current, [before, after]) => current.replace(before, after), `/${path}`).slice(1);
      const data = readFileSync(file);
      let content = data;
      if (TEXT_EXTENSIONS.has(extname(file))) {
        const text = data.toString("utf8");
        const renamed = renames.reduce((current, [before, after]) => current.replaceAll(before, after), text);
        content = renamed === text ? data : renamed;
      }
      if (newPath !== path) {
        changes.set(path, null);
        changes.set(newPath, content);
      } else if (content !== data) {
        changes.set(path, content);
      }
    }
  }
  return changes;
}

/** The ASCII spelling used for identifiers: accents are dropped, so `Lumière` becomes `Lumiere`. */
export function asciiSpelling(name) {
  return name.normalize("NFKD").replace(/\p{M}/gu, "");
}

export function renameChanges(requested, directory = root) {
  const name = typeof requested === "string" ? requested.normalize("NFC") : "";
  const ascii = asciiSpelling(name);
  // Letters from any alphabet may appear in the display name, but identifiers need an ASCII spelling.
  if (!/^\p{L}[\p{L}\p{N} ]{0,47}$/u.test(name) || name.trim() !== name || !/^[A-Za-z][A-Za-z0-9 ]*$/.test(ascii)) {
    throw new Error("Use 1–48 letters, numbers or spaces, beginning with a letter and without outer spaces. Accented letters are fine.");
  }
  const old = readBrand(directory);
  const slug = ascii.toLowerCase().replace(/ +/g, "-");
  const prefix = ascii.replace(/ +/g, "");
  const packagePart = prefix.toLowerCase();
  const brand = { ...old, name, slug, java: {
    package: `dev.${packagePart}.ftc`, simPackage: `dev.${packagePart}.sim`,
    classPrefix: prefix, generatedPackageSuffix: `${packagePart}.generated`,
  } };
  const changes = brandChanges(directory, brand);
  const source = readFileSync(resolve(directory, "app/src/brand.ts"), "utf8");
  const after = source.replace(/export const BRAND = (\{[\s\S]*?\}) as const;/,
    () => `export const BRAND = ${JSON.stringify(brand, null, 2)} as const;`);
  if (after !== source) changes.set("app/src/brand.ts", after);
  for (const [path, content] of javaPackageChanges(directory, old.java, brand.java)) changes.set(path, content);
  return changes;
}

/** Generated Java and the Java hints embed the product name or package, so they are regenerated, not edited. */
function regenerateGoldenFiles() {
  const result = spawnSync("npx vitest run src/core/codegen/java/generate.test.ts src/core/javaHints/javaHints.test.ts", {
    cwd: resolve(root, "app"),
    env: { ...process.env, UPDATE_GOLDEN: "1" },
    shell: true,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error("Could not regenerate fixtures/golden and fixtures/java-hints.json. Run `UPDATE_GOLDEN=1 npx vitest run src/core/codegen src/core/javaHints` in app/.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const nameIndex = args.indexOf("--name");
  const name = args[nameIndex + 1];
  const modes = args.filter((arg) => ["--apply", "--dry-run"].includes(arg));
  if (args.length !== 3 || nameIndex < 0 || modes.length !== 1 || !name || name.startsWith("--")) {
    throw new Error('Usage: node scripts/rename.mjs --name "New Name" --dry-run|--apply');
  }
  const changes = renameChanges(name);
  const listing = [...changes].map(([path, content]) => (content === null ? `${path} (moved)` : path));
  console.log(`${modes[0] === "--apply" ? "Updating" : "Would update"} ${changes.size} files:\n${listing.join("\n")}`);
  if (modes[0] === "--apply") {
    writeChanges(changes);
    if (changes.size) regenerateGoldenFiles();
    console.log("Delete robot/*/build folders before the next Gradle build so old package output is not reused.");
  } else {
    console.log("Applying also regenerates fixtures/golden and fixtures/java-hints.json with the new name.");
  }
}
