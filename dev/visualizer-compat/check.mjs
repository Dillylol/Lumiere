// Development only: how Lumière's shipped .pp importer and exporter (app/src/core/pp/visualizer.ts,
// bundled unchanged) handle the Pedro Pathing Visualizer's current file format.
//
// Inputs are the Visualizer's own test fixtures and their golden parse results, fetched at a pinned
// upstream commit into work/ (data only: never executed, never committed), plus small synthetic files
// for format 2.0.0 features those fixtures do not cover.
//
//   node dev/visualizer-compat/check.mjs [--commit <sha>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const args = process.argv.slice(2);
const commit = args.includes("--commit") ? args[args.indexOf("--commit") + 1] : "97104e027af00d49b8bd61e29bcb74a9d7e62b90";
const work = resolve(here, "work");
mkdirSync(work, { recursive: true });

// Bundle the shipped importer exactly as it is.
const esbuild = (await import(pathToFileURL(resolve(repo, "app/node_modules/esbuild/lib/main.js")).href)).default;
const bundle = resolve(work, "visualizer.bundle.mjs");
await esbuild.build({
  stdin: {
    resolveDir: repo,
    contents: 'export * from "./app/src/core/pp/visualizer"; export { curveBetween } from "./app/src/core/geometry/curves";',
  },
  bundle: true, format: "esm", platform: "node", outfile: bundle, logLevel: "error",
});
const { importVisualizer, exportVisualizer, VISUALIZER_VERSION, curveBetween } = await import(`${pathToFileURL(bundle).href}?${Date.now()}`);

const FIXTURES = ["default-1.5", "features-1.5", "settings-1.5", "legacy-endpoint-heading", "legacy-path-heading"];
const upstream = async (path) => {
  const cached = resolve(work, `upstream-${commit.slice(0, 12)}`, path);
  if (existsSync(cached)) return readFileSync(cached, "utf8");
  const response = await fetch(`https://raw.githubusercontent.com/Pedro-Pathing/Visualizer/${commit}/${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const text = await response.text();
  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, text);
  return text;
};

// --------------------------------------------------------------------------------------------
// Canonical forms, so Lumière's model and the Visualizer's can be compared field by field.

const r = (n) => Math.round(n * 1000) / 1000;
const pt = (p) => `(${r(p.x)}, ${r(p.y)})`;

function upstreamHeading(h) {
  if (!h) return "none";
  switch (h.type) {
    case "linear": return `linear ${r(h.startDeg)}→${r(h.endDeg)}`;
    case "constant": return `constant ${r(h.degrees)}`;
    case "tangential": return h.reverse ? "reverse tangent" : "tangent";
    case "piecewise": return `piecewise[${h.piecewiseHeading.segments.map((s) => {
      const range = `${r(s.startProgress)}-${r(s.endProgress)}`;
      const p = s.parameters ?? {};
      switch (s.interpolationType) {
        case "linear": return `${range} linear ${s.continueFromPrevious ? "*" : r(p.startDeg)}→${r(p.endDeg)}`;
        case "constant": return `${range} constant ${s.continueFromPrevious ? "*" : r(p.degrees)}`;
        case "facing-point": return `${range} facing ${pt(p.point)}`;
        default: return `${range} ${s.reversed ? "reverse tangent" : "tangent"}`;
      }
    }).join("; ")}]`;
    default: return `unknown ${h.type}`;
  }
}

/** Lumière resolves "continue from previous" angles; mark them so they compare with the source flag. */
function lumiereHeading(h, continued = []) {
  if (!h) return "none";
  switch (h.type) {
    case "linear": return `linear ${r(h.startDeg)}→${r(h.endDeg)}`;
    case "constant": return `constant ${r(h.degrees)}`;
    case "tangential": return h.reverse ? "reverse tangent" : "tangent";
    case "piecewise": return `piecewise[${h.segments.map((s, i) => {
      const range = `${r(s.startProgress)}-${r(s.endProgress)}`;
      switch (s.type) {
        case "linear": return `${range} linear ${continued[i] ? "*" : r(s.startDeg)}→${r(s.endDeg)}`;
        case "constant": return `${range} constant ${continued[i] ? "*" : r(s.degrees)}`;
        case "facingPoint": return `${range} facing ${pt(s.point)}`;
        default: return `${range} ${s.reverse ? "reverse tangent" : "tangent"}`;
      }
    }).join("; ")}]`;
    default: return `unknown ${h.type}`;
  }
}

const continuedFlags = (line) => line.heading?.type === "piecewise" ? line.heading.piecewiseHeading.segments.map((s) => s.continueFromPrevious === true) : [];

/** Drivable segments in order, from the Visualizer's normalized document. */
function upstreamSegments(doc) {
  const out = [];
  const visit = (line, groupHeading) => {
    if (line.kind === "compound") return line.segments.forEach((child) => visit(child, line.heading ?? groupHeading));
    out.push({
      id: line.id,
      end: pt(line.endPoint),
      controls: line.controlPoints.map(pt).join(" "),
      through: line.throughPoints ?? [],
      heading: upstreamHeading(line.heading),
      group: groupHeading ? upstreamHeading(groupHeading) : "",
    });
  };
  doc.lines.forEach((line) => visit(line, null));
  return out;
}

function lumiereSegments(imported, source) {
  const flags = new Map();
  const collect = (line) => { if (line.kind === "compound" || Array.isArray(line.segments)) line.segments.forEach(collect); else flags.set(line.id, continuedFlags(line)); };
  source.lines.forEach(collect);
  const out = [];
  let start = imported.start;
  for (const path of imported.paths) {
    const segments = path.kind === "atomic" ? [path] : path.segments;
    for (const segment of segments) {
      const segmentStart = start;
      start = segment.end;
      out.push({
        id: segment.id,
        end: pt(segment.end),
        controls: segment.controlPoints.map(pt).join(" "),
        at: t => curveBetween(segmentStart, segment.controlPoints, segment.end).get(t),
        controlCount: segment.controlPoints.length,
        heading: lumiereHeading(segment.heading, flags.get(segment.id) ?? []),
        group: path.kind === "compound" && path.heading ? lumiereHeading(path.heading) : "",
      });
    }
  }
  return out;
}

/** The order of paths and waits a robot would run. */
function upstreamRun(doc) {
  const byId = new Map();
  const index = (line, top) => {
    byId.set(line.id, top);
    if (line.kind === "compound") line.segments.forEach(segment => index(segment, top));
  };
  doc.lines.forEach((line) => index(line, line));
  const steps = [];
  let last = null;
  for (const item of doc.sequence) {
    if (item.kind === "wait") { steps.push(`wait ${item.durationMs}`); last = null; continue; }
    const top = byId.get(item.lineId);
    if (!top || (top === last && top.kind === "compound" && item.lineId !== top.id && item.lineId !== top.segments[0]?.id)) continue;
    if (top.waitBeforeMs > 0) steps.push(`wait ${top.waitBeforeMs}`);
    // Paths are compared by position: files without ids get generated ones on both sides.
    steps.push(`path #${doc.lines.indexOf(top) + 1}`);
    if (top.waitAfterMs > 0) steps.push(`wait ${top.waitAfterMs}`);
    last = top;
  }
  return steps;
}

const lumiereRun = (imported) => imported.routine.map((step) => step.kind === "wait" ? `wait ${step.ms}` : `path #${imported.paths.findIndex((path) => path.id === step.pathId) + 1}`);

// --------------------------------------------------------------------------------------------

const findings = [];
const note = (level, file, text) => { findings.push({ level, file, text }); };
const compare = (file, field, theirs, ours) => {
  if (JSON.stringify(theirs) !== JSON.stringify(ours)) note("DIFF", file, `${field}: Visualizer ${JSON.stringify(theirs)} / Lumière ${JSON.stringify(ours)}`);
};

function checkThrough(file, label, through, segment) {
  if (!segment || segment.controlCount !== through.length) {
    note("FAIL", file, label + " was not converted to the same-degree Bézier.");
    return;
  }
  through.forEach((point, i) => {
    const at = segment.at((i + 1) / (through.length + 1));
    if (Math.hypot(at.x - point.x, at.y - point.y) > 1e-6) {
      note("FAIL", file, label + " misses through point " + (i + 1) + ": expected " + pt(point) + ", got " + pt(at));
    }
  });
}

function checkImport(file, text, golden, robot) {
  let imported;
  try {
    imported = importVisualizer(text, { robot });
  } catch (error) {
    note("FAIL", file, `import threw: ${error.message}`);
    return null;
  }
  const source = JSON.parse(text);
  imported.warnings.forEach((warning) => note("WARN", file, warning));
  if (golden) {
    compare(file, "start", pt(golden.startPoint) + ` ${r(golden.startPoint.headingDeg)}°`, pt(imported.start) + ` ${r(imported.start.headingDeg)}°`);
    const theirs = upstreamSegments(golden), ours = lumiereSegments(imported, source);
    compare(file, "segment count", theirs.length, ours.length);
    theirs.forEach((segment, i) => {
      const mine = ours[i] ?? {};
      const label = "segment " + (i + 1) + " (" + segment.id + ")";
      for (const key of ["end", "heading", "group"]) compare(file, label + " " + key, segment[key], mine[key]);
      if (segment.through.length) checkThrough(file, label, segment.through, ours[i]);
      else compare(file, label + " controls", segment.controls, mine.controls);
    });
    compare(file, "run order", upstreamRun(golden), lumiereRun(imported));
  }
  return imported;
}

function checkExport(file, imported, robot) {
  const { text, warnings } = exportVisualizer(imported, { robot });
  warnings.forEach((warning) => note("WARN", file, `export: ${warning}`));
  const doc = JSON.parse(text);
  const problems = [];
  if (typeof doc.startPoint !== "object" || !Array.isArray(doc.lines)) problems.push("missing startPoint or lines (the Visualizer refuses the file)");
  const ids = new Set();
  const visit = (line) => {
    if (line.kind === "compound") { if (!Array.isArray(line.segments) || !line.segments.length) problems.push(`empty group ${line.id}`); line.segments.forEach(visit); return; }
    ids.add(line.id);
    if (!line.id || !line.endPoint || !Array.isArray(line.controlPoints) || typeof line.heading !== "object") problems.push(`incomplete path ${line.id}`);
  };
  doc.lines.forEach(visit);
  for (const item of doc.sequence) if (item.kind === "path" && !ids.has(item.lineId)) problems.push(`sequence refers to missing path ${item.lineId}`);
  problems.forEach((problem) => note("FAIL", file, `export: ${problem}`));
  const again = importVisualizer(text, { robot });
  const before = lumiereSegments(imported, { lines: [] }), after = lumiereSegments(again, { lines: [] });
  compare(file, "export round trip geometry", before.map((s) => [s.end, s.controls, s.heading]), after.map((s) => [s.end, s.controls, s.heading]));
  compare(file, "export round trip run order", lumiereRun(imported), lumiereRun(again));
  return doc;
}

console.log(`Lumière importer writes Visualizer format ${VISUALIZER_VERSION}; upstream Visualizer at ${commit.slice(0, 12)}`);
const projectFile = await upstream("src/io/project.ts");
const upstreamVersion = /PROJECT_VERSION = "([^"]+)"/.exec(projectFile)?.[1] ?? "unknown";
console.log(`Upstream writes format ${upstreamVersion}\n`);

for (const name of FIXTURES) {
  const text = await upstream(`test/fixtures/projects/${name}.pp`);
  const golden = JSON.parse(await upstream(`test/golden/${name}/normalized.json`));
  const imported = checkImport(`${name}.pp`, text, golden);
  if (imported) checkExport(`${name}.pp`, imported);
}

// Format 2.0.0 features the upstream fixtures do not cover (written here, not copied).
const synthetic = {
  "through-points-2.0.pp": {
    version: "2.0.0",
    startPoint: { x: 24, y: 72, headingDeg: 0 },
    lines: [{ kind: "atomic", id: "through", color: "#5B9BD5", endPoint: { x: 120, y: 72 }, controlPoints: [], throughPoints: [{ x: 60, y: 110 }, { x: 90, y: 40 }], heading: { type: "tangential", reverse: false } }],
    shapes: [], sequence: [{ kind: "path", lineId: "through" }], fieldPoints: [],
    robot: { forwardVelocity: 70, strafeVelocity: 55, aVelocity: 6, kFriction: 0.1, rLength: 17, rWidth: 15, safetyMargin: 1, maxAcceleration: 60, maxDeceleration: 50 },
    activePaths: [],
  },
};
for (const [name, document] of Object.entries(synthetic)) {
  const robot = { lengthInches: 18, widthInches: 14 };
  const imported = checkImport(name, JSON.stringify(document), null, robot);
  if (!imported) continue;
  checkThrough(name, "the 2.0.0 path", document.lines[0].throughPoints, lumiereSegments(imported, document)[0]);
  if (!imported.warnings.some(warning => warning.includes("converted to Bezier control points"))) {
    note("FAIL", name, "The through-point conversion was not reported.");
  }
  if (!imported.warnings.some(warning => warning.includes("size and motion settings were not imported") && warning.includes("18 × 14 in"))) {
    note("FAIL", name, "The ignored robot settings and retained project size were not reported.");
  }
  const exported = checkExport(name, imported, robot);
  if (JSON.stringify(exported.robot) !== JSON.stringify({ rLength: 18, rWidth: 14 })) {
    note("FAIL", name, "The export did not write the project’s robot dimensions in 2.0.0 format.");
  }
}

const order = { FAIL: 0, DROP: 1, DIFF: 2, WARN: 3 };
findings.sort((a, b) => order[a.level] - order[b.level] || a.file.localeCompare(b.file));
for (const finding of findings) console.log(`${finding.level.padEnd(5)} ${finding.file.padEnd(32)} ${finding.text}`);
const serious = findings.filter((f) => f.level !== "WARN");
console.log(`\n${findings.length} findings, ${serious.length} beyond warnings.`);
process.exit(findings.some((f) => f.level === "FAIL") ? 1 : 0);
