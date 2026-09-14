// Creates a robot project from the official FTC SDK plus this repository's quickstart overlay.
// Upstream code is downloaded at pinned versions and verified by SHA-256; none of it is stored here.
//
// Usage: node scripts/quickstart.mjs --out <directory> [--robot-library release|local] [--cache <directory>]
//   release: the robot library from JitPack, for the repository and version in app/src/brand.ts and app/package.json
//   local:   the robot library built from this checkout (development and CI)
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { readBrand, root } from "./brand.mjs";

export const sources = () => JSON.parse(readFileSync(resolve(root, "quickstart/sources.json"), "utf8"));

export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Reads a (non-zip64) archive and returns its file entries. Rejects paths that escape the destination. */
export function readZip(buffer) {
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("Archive is not a valid zip file.");
  const count = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) throw new Error("Corrupt zip central directory.");
    const madeBy = buffer.readUInt16LE(pointer + 4) >> 8;
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const externalAttributes = buffer.readUInt32LE(pointer + 38);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString("utf8", pointer + 46, pointer + 46 + nameLength);
    pointer += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (isAbsolute(name) || name.split(/[\\/]/).includes("..")) throw new Error(`Unsafe path in archive: ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`Unsupported zip compression method ${method} for ${name}.`);
    const mode = madeBy === 3 ? (externalAttributes >>> 16) & 0o777 : 0;
    entries.push({ name, data, executable: (mode & 0o111) !== 0 });
  }
  return entries;
}

export function substituteTokens(text, tokens) {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    if (!(key in tokens)) throw new Error(`Unknown template token ${match}.`);
    return tokens[key];
  });
}

function safeTarget(directory, path) {
  const target = resolve(directory, normalize(path));
  const rel = relative(directory, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Refusing to write outside the project: ${path}`);
  return target;
}

function write(directory, path, data, executable = false) {
  const target = safeTarget(directory, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
  if (executable && process.platform !== "win32") chmodSync(target, 0o755);
}

async function download(url, expectedSha, cacheDirectory) {
  const cached = join(cacheDirectory, expectedSha);
  if (existsSync(cached)) {
    const data = readFileSync(cached);
    if (sha256(data) === expectedSha) return data;
  }
  let response;
  for (let attempt = 1; ; attempt += 1) {
    try {
      response = await fetch(url);
      break;
    } catch (error) {
      if (attempt >= 3) throw new Error(`Could not download ${url}: ${error.cause?.message ?? error.message}`);
      await new Promise((done) => setTimeout(done, 1000 * attempt));
    }
  }
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  const data = Buffer.from(await response.arrayBuffer());
  const actual = sha256(data);
  if (actual !== expectedSha) {
    throw new Error(`Checksum mismatch for ${url}\n  expected ${expectedSha}\n  received ${actual}`);
  }
  mkdirSync(cacheDirectory, { recursive: true });
  writeFileSync(cached, data);
  return data;
}

function listFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const TEXT_EXTENSIONS = new Set([".gradle", ".java", ".md", ".yml", ".yaml", ".json", ".properties", ".txt", ".xml", ".kts"]);

export function robotLibraryCoordinates(robotLibrary, brand = readBrand()) {
  if (robotLibrary === "local") return { coordinates: brand.java.package, version: "0.0.0-local" };
  if (robotLibrary !== "release") throw new Error(`Unknown robot library mode: ${robotLibrary}`);
  if (!brand.repository) {
    throw new Error("Release quickstarts need a public repository in app/src/brand.ts. Use --robot-library local for development.");
  }
  const version = JSON.parse(readFileSync(resolve(root, "app/package.json"), "utf8")).version;
  return { coordinates: `com.github.${brand.repository.owner}.${brand.repository.name}`, version: `v${version}` };
}

export function tokensFor({ brand = readBrand(), pinned = sources(), robotLibrary = "release" } = {}) {
  const library = robotLibraryCoordinates(robotLibrary, brand);
  return {
    ...pinned.versions,
    APP_NAME: brand.name,
    JAVA_PACKAGE: brand.java.package,
    SIM_PACKAGE: brand.java.simPackage,
    ROBOT_LIBRARY_COORDINATES: library.coordinates,
    ROBOT_LIBRARY_VERSION: library.version,
    PEDRO_QUICKSTART_COMMIT: pinned.pedroTuningProcedures.commit,
    FTC_SDK_TAG: pinned.ftcSdk.tag,
  };
}

export async function createQuickstart({ out, robotLibrary = "release", cacheDirectory = join(tmpdir(), "ftc-quickstart-cache") }) {
  const destination = resolve(out);
  if (existsSync(destination) && readdirSync(destination).length) {
    throw new Error(`Destination is not empty: ${destination}`);
  }
  const pinned = sources();
  const tokens = tokensFor({ pinned, robotLibrary });

  const sdk = readZip(await download(pinned.ftcSdk.url, pinned.ftcSdk.sha256, cacheDirectory));
  for (const entry of sdk) {
    if (!entry.name.startsWith(pinned.ftcSdk.stripPrefix)) throw new Error(`Unexpected SDK archive layout: ${entry.name}`);
    let path = entry.name.slice(pinned.ftcSdk.stripPrefix.length);
    // The SDK repository's contribution templates do not apply to a team project.
    if (path.startsWith(".github/")) continue;
    if (path === "README.md") path = "doc/FTC_SDK_README.md";
    write(destination, path, entry.data, entry.executable || path === "gradlew");
  }

  const procedures = pinned.pedroTuningProcedures;
  for (const file of procedures.files) {
    const data = await download(`${procedures.baseUrl}${file.path}`, file.sha256, cacheDirectory);
    write(destination, file.target ?? file.path, data);
  }

  const overlay = resolve(root, "quickstart/overlay");
  for (const file of listFiles(overlay)) {
    const path = relative(overlay, file).split(sep).join("/");
    const extension = path.slice(path.lastIndexOf("."));
    const data = TEXT_EXTENSIONS.has(extension)
      ? Buffer.from(substituteTokens(readFileSync(file, "utf8"), tokens))
      : readFileSync(file);
    write(destination, path, data);
  }

  const teamCodeBuild = join(destination, "TeamCode/build.gradle");
  const applyLine = "apply from: 'libraries.gradle'";
  const teamCodeText = readFileSync(teamCodeBuild, "utf8");
  if (!teamCodeText.includes(applyLine)) {
    writeFileSync(teamCodeBuild, `${teamCodeText.trimEnd()}\n\n// Pedro Pathing, Panels, and robot-library dependencies\n${applyLine}\n`);
  }

  if (robotLibrary === "local") {
    const settings = join(destination, "settings.gradle");
    const robotBuild = resolve(root, "robot").split(sep).join("/");
    writeFileSync(settings, `${readFileSync(settings, "utf8").trimEnd()}\n\n// Development only: use the robot library from a local checkout.\nincludeBuild('${robotBuild}')\n`);
  }
  return destination;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const out = value("--out");
  const robotLibrary = value("--robot-library") ?? "release";
  if (!out || !["release", "local"].includes(robotLibrary)) {
    console.error("Usage: node scripts/quickstart.mjs --out <directory> [--robot-library release|local] [--cache <directory>]");
    process.exit(2);
  }
  createQuickstart({ out, robotLibrary, cacheDirectory: value("--cache") })
    .then((path) => console.log(`Created ${path}`))
    .catch((error) => { console.error(error.message); process.exit(1); });
}
