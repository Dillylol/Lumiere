import { newId, pathColor } from "../ir/create";
import type { AtomicPath, Heading, HeadingSegment, PathDoc, Point, RobotProfile, StartPose, Step } from "../ir/types";
import { toDegrees, type Curve } from "../geometry/curves";
import { headingAt } from "../geometry/headings";
import { resolvePath } from "../geometry/paths";

/**
 * Reads and writes Pedro Pathing Visualizer `.pp` files. Format 2.0.0, 1.5.0, and the earlier
 * format that stored headings on end points are all read; 2.0.0 is written.
 *
 * The Visualizer's shapes, field points, and display settings have no equivalent in a robot program
 * and are not imported. Its robot settings (size, speeds, accelerations) belong to the project, which
 * an import never changes, so they are described instead of applied. Paths drawn through points
 * (Pedro's `Paths.through`) are imported as the Bezier curve with the same shape. Mechanism steps
 * and step groups have no `.pp` equivalent and are left out when exporting. Each case is reported
 * as a warning.
 */

export const VISUALIZER_VERSION = "2.0.0";

/** The format version that moved robot settings from the `settings` block to a `robot` block. */
const ROBOT_BLOCK_VERSION = "2.0.0";

/** A robot's footprint. Length runs along the heading (front to back), width side to side. */
export type RobotSize = Pick<RobotProfile, "lengthInches" | "widthInches">;

export interface ImportOptions {
  /** The project's robot, so a robot size in the file can be compared with it. */
  robot?: RobotSize;
}

export interface ImportedPaths {
  start: StartPose;
  paths: PathDoc[];
  routine: Step[];
  warnings: string[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const finiteOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

function point(value: unknown): Point {
  const source = isObject(value) ? value : {};
  return { x: num(source.x), y: num(source.y) };
}

function legacyHeading(source: Json, curve: Curve | null = null): Heading {
  switch (source.heading) {
    case "linear": return { type: "linear", startDeg: num(source.startDeg), endDeg: num(source.endDeg) };
    case "constant": return { type: "constant", degrees: num(source.degrees) };
    case "tangential": return { type: "tangential", reverse: source.reverse === true };
    case "piecewise": return isObject(source.piecewiseHeading) ? piecewiseFrom(source.piecewiseHeading, curve) : { type: "tangential", reverse: false };
    default: return { type: "tangential", reverse: false };
  }
}

function piecewiseFrom(value: Json, curve: Curve | null): Heading {
  const raw = Array.isArray(value.segments) ? value.segments.filter(isObject) : [];
  const segments: HeadingSegment[] = [];
  let previousEnd: number | null = null;
  for (const item of raw) {
    const parameters = isObject(item.parameters) ? item.parameters : {};
    const startProgress = Math.max(0, Math.min(1, num(item.startProgress)));
    const endProgress = Math.max(startProgress, Math.min(1, num(item.endProgress, 1)));
    const continued = item.continueFromPrevious === true && previousEnd !== null;
    let segment: HeadingSegment;
    switch (item.interpolationType) {
      case "linear":
        segment = { startProgress, endProgress, type: "linear", startDeg: continued ? previousEnd! : num(parameters.startDeg), endDeg: num(parameters.endDeg) };
        break;
      case "constant":
        segment = { startProgress, endProgress, type: "constant", degrees: continued ? previousEnd! : num(parameters.degrees) };
        break;
      case "facing-point":
        segment = { startProgress, endProgress, type: "facingPoint", point: point(parameters.point) };
        break;
      default:
        segment = { startProgress, endProgress, type: "tangential", reverse: item.reversed === true };
    }
    segments.push(segment);
    previousEnd = segmentEndDegrees(segment, curve);
  }
  return segments.length ? { type: "piecewise", segments } : { type: "tangential", reverse: false };
}

function segmentEndDegrees(segment: HeadingSegment, curve: Curve | null): number | null {
  switch (segment.type) {
    case "linear": return segment.endDeg;
    case "constant": return segment.degrees;
    default: return curve ? toDegrees(headingAt({ type: "piecewise", segments: [segment] }, curve, curve.parameter(segment.endProgress))) : null;
  }
}

function headingFrom(line: Json, curve: Curve | null): Heading {
  const heading = line.heading;
  if (isObject(heading) && typeof heading.type === "string") {
    switch (heading.type) {
      case "linear": return { type: "linear", startDeg: num(heading.startDeg), endDeg: num(heading.endDeg) };
      case "constant": return { type: "constant", degrees: num(heading.degrees) };
      case "tangential": return { type: "tangential", reverse: heading.reverse === true };
      case "piecewise": return isObject(heading.piecewiseHeading) ? piecewiseFrom(heading.piecewiseHeading, curve) : { type: "tangential", reverse: false };
    }
  }
  const endPoint = isObject(line.endPoint) ? line.endPoint : {};
  return legacyHeading(typeof heading === "string" ? { ...endPoint, heading } : endPoint, curve);
}

/** The Bernstein basis of degree `n` at `t`: C(n, j) t^j (1 - t)^(n - j) for j = 0 to n. */
function bernstein(n: number, t: number): number[] {
  const values: number[] = [];
  let binomial = 1;
  for (let j = 0; j <= n; j++) {
    values.push(binomial * t ** j * (1 - t) ** (n - j));
    binomial = (binomial * (n - j)) / (j + 1);
  }
  return values;
}

/**
 * The control points between `start` and `end` of the curve Pedro Pathing builds for
 * `Paths.through(start, ...through, end)`. Pedro interpolates: for N points in all it solves for the
 * degree N - 1 Bezier curve that passes through point i at t = i / (N - 1). The start and end are
 * that curve's first and last control points, so the unknowns are the interior control points, one
 * per through point.
 */
function throughControlPoints(start: Point, through: readonly Point[], end: Point): Point[] {
  const size = through.length;
  const degree = size + 1;
  // Row i says the curve at t = (i + 1) / degree is through point i, with the known start and end
  // terms moved to the right. There are two right-hand sides, x and y.
  const rows = through.map((target, i) => {
    const basis = bernstein(degree, (i + 1) / degree);
    return [
      ...basis.slice(1, degree),
      target.x - basis[0] * start.x - basis[degree] * end.x,
      target.y - basis[0] * start.y - basis[degree] * end.y,
    ];
  });
  // Gaussian elimination with partial pivoting.
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    for (let row = column + 1; row < size; row++) {
      const factor = rows[row][column] / rows[column][column];
      for (let k = column; k < size + 2; k++) rows[row][k] -= factor * rows[column][k];
    }
  }
  // Back substitution.
  const controls = new Array<Point>(size);
  for (let row = size - 1; row >= 0; row--) {
    let x = rows[row][size];
    let y = rows[row][size + 1];
    for (let k = row + 1; k < size; k++) {
      x -= rows[row][k] * controls[k].x;
      y -= rows[row][k] * controls[k].y;
    }
    controls[row] = { x: x / rows[row][row], y: y / rows[row][row] };
  }
  return controls;
}

/** Counts of paths whose geometry was rewritten on import, for the warnings. */
interface ThroughTally {
  /** Paths drawn through points, imported as control points. */
  converted: number;
  /** Of those, paths that also stored control points, which the Visualizer ignores. */
  ignoredControls: number;
}

function atomicFrom(line: Json, index: number, start: Point, tally: ThroughTally): AtomicPath {
  const end = point(line.endPoint);
  const stored = Array.isArray(line.controlPoints) ? line.controlPoints.map(point) : [];
  const through = Array.isArray(line.throughPoints) ? line.throughPoints.map(point) : [];
  let controlPoints = stored;
  if (through.length) {
    if (through.length > 16) throw new Error("Lumière supports up to 16 through points per path. Split the path in Pedro Pathing Visualizer and try again.");
    // The Visualizer draws, and Pedro drives, the curve through these points; it ignores any stored
    // control points. The same curve written with control points needs no model of its own.
    controlPoints = throughControlPoints(start, through, end);
    tally.converted++;
    if (stored.length) tally.ignoredControls++;
  }
  const doc: AtomicPath = {
    id: str(line.id) || newId("path"),
    name: str(line.name),
    color: str(line.color) || pathColor(index),
    kind: "atomic",
    end,
    controlPoints,
    heading: { type: "tangential", reverse: false },
  };
  doc.heading = headingFrom(line, headingCurve(line, doc, start));
  return doc;
}

/** Only piecewise continuation needs the curve while reading the heading. */
function headingCurve(line: Json, doc: PathDoc, start: Point): Curve | null {
  const heading = line.heading;
  const endPoint = isObject(line.endPoint) ? line.endPoint : {};
  const isPiecewise = isObject(heading) ? heading.type === "piecewise" : (heading ?? endPoint.heading) === "piecewise";
  if (!isPiecewise) return null;
  try {
    return resolvePath(doc, start).curve;
  } catch {
    // Invalid geometry is reported by project validation.
    return null;
  }
}

function throughWarning(tally: ThroughTally): string {
  const paths = tally.converted === 1 ? "1 path drawn through points was" : `${tally.converted} paths drawn through points were`;
  const ignored = tally.ignoredControls
    ? " Control points saved alongside the through points were ignored, as they are in the Visualizer."
    : "";
  return `${paths} converted to Bezier control points with the same shape.${ignored}`;
}

/** Robot settings other than size, by their 2.0.0 names. */
const ROBOT_MOTION_KEYS = ["forwardVelocity", "strafeVelocity", "aVelocity", "kFriction", "safetyMargin", "maxAcceleration", "maxDeceleration"];

/**
 * Where files before 2.0.0 kept each robot setting in their `settings` block, by its 2.0.0 name,
 * preferred source first. Those files named the speeds by axis and measured `rWidth` along the
 * heading and `rHeight` across it.
 */
const LEGACY_ROBOT_SETTINGS: Record<string, string[]> = {
  forwardVelocity: ["xVelocity", "forwardVelocity"],
  strafeVelocity: ["yVelocity", "strafeVelocity"],
  aVelocity: ["aVelocity"],
  kFriction: ["kFriction"],
  rLength: ["rWidth", "rLength"],
  rWidth: ["rHeight"],
  safetyMargin: ["safetyMargin"],
  maxAcceleration: ["maxAcceleration"],
  maxDeceleration: ["maxDeceleration"],
};

/**
 * The file's robot settings by their 2.0.0 names: its `robot` block, or for an older file the same
 * settings in its `settings` block. Like the Visualizer, a current file's `settings` block is ignored.
 */
function robotOf(data: Json, version: string): Json | null {
  const settings = data.settings;
  if (compareVersions(version, ROBOT_BLOCK_VERSION) < 0 && isObject(settings)) {
    const robot: Json = {};
    for (const [key, sources] of Object.entries(LEGACY_ROBOT_SETTINGS)) {
      const source = sources.find((name) => name in settings);
      if (source !== undefined) robot[key] = settings[source];
    }
    return robot;
  }
  return isObject(data.robot) ? data.robot : null;
}

const inches = (value: number) => `${Math.round(value * 100) / 100}`;

function sizeText(length: number | null, width: number | null): string {
  if (length !== null && width !== null) return `${inches(length)} × ${inches(width)} in (length × width)`;
  if (length !== null) return `${inches(length)} in long`;
  return `${inches(width ?? 0)} in wide`;
}

/**
 * Describes the file's robot settings, which are never applied: the robot size and motion settings
 * belong to the project. Null when the file has none, or only a size equal to the project's.
 */
function robotWarning(robot: Json, project: RobotSize | undefined): string | null {
  const length = finiteOrNull(robot.rLength);
  const width = finiteOrNull(robot.rWidth);
  const motion = ROBOT_MOTION_KEYS.some((key) => finiteOrNull(robot[key]) !== null);
  if (length === null && width === null) return motion ? "The file's robot motion settings were not imported." : null;
  const size = sizeText(length, width);
  const sameSize = project !== undefined
    && (length === null || inches(length) === inches(project.lengthInches))
    && (width === null || inches(width) === inches(project.widthInches));
  if (sameSize) return motion ? `The file's robot is ${size}, the same as this project's. Its motion settings were not imported.` : null;
  const dropped = motion ? "Its size and motion settings were not imported" : "Its size was not imported";
  const kept = project ? `; this project's robot stays ${inches(project.lengthInches)} × ${inches(project.widthInches)} in.` : ".";
  return `The file's robot is ${size}. ${dropped}${kept}`;
}

function waitStep(ms: number): Step {
  return { id: newId("step"), kind: "wait", ms };
}

/** Parses `.pp` file text. Throws with a readable message when the file is not a Visualizer project. */
export function importVisualizer(text: string, options: ImportOptions = {}): ImportedPaths {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON, so it is not a Pedro Pathing Visualizer file.");
  }
  if (!isObject(data) || !Array.isArray(data.lines)) {
    throw new Error("This file does not contain Pedro Pathing Visualizer paths.");
  }
  const warnings: string[] = [];
  const version = str(data.version);
  if (version && compareVersions(version, VISUALIZER_VERSION) > 0) {
    warnings.push(`This file was saved by a newer Visualizer (${version}). Newer features may be missing.`);
  }
  if (Array.isArray(data.shapes) && data.shapes.length) warnings.push("Obstacle shapes were not imported.");
  if (Array.isArray(data.fieldPoints) && data.fieldPoints.length) warnings.push("Field markers were not imported.");
  const robot = robotOf(data, version);
  const robotNote = robot ? robotWarning(robot, options.robot) : null;
  if (robotNote) warnings.push(robotNote);

  const startSource = isObject(data.startPoint) ? data.startPoint : {};
  const startHeading = typeof startSource.headingDeg === "number"
    ? startSource.headingDeg
    : headingStartDegrees(legacyHeading(startSource));
  const start: StartPose = { x: num(startSource.x), y: num(startSource.y), headingDeg: startHeading };

  const paths: PathDoc[] = [];
  const waits = new Map<string, { before: number; after: number }>();
  const topLevelOf = new Map<string, string>();
  const compoundStarts = new Map<string, string>();
  const tally: ThroughTally = { converted: 0, ignoredControls: 0 };
  let cursor: Point = start;
  data.lines.filter(isObject).forEach((line, index) => {
    const color = str(line.color) || pathColor(index);
    if (Array.isArray(line.segments)) {
      const groupStart = cursor;
      const segments: AtomicPath[] = [];
      for (const [segmentIndex, segment] of line.segments.filter(isObject).entries()) {
        if (segment.kind === "compound" || Array.isArray(segment.segments)) {
          throw new Error("Lumière supports one level of path grouping. Ungroup nested paths in Pedro Pathing Visualizer and try again.");
        }
        const atomic = atomicFrom(segment, index + segmentIndex, cursor, tally);
        segments.push(atomic);
        cursor = atomic.end;
      }
      const compound: PathDoc = {
        id: str(line.id) || newId("path"),
        name: str(line.name),
        color,
        kind: "compound",
        segments,
        heading: null,
      };
      if (!segments.length) {
        warnings.push(`An empty path group "${compound.name}" was skipped.`);
        return;
      }
      if (isObject(line.heading)) compound.heading = headingFrom(line, headingCurve(line, compound, groupStart));
      paths.push(compound);
      topLevelOf.set(compound.id, compound.id);
      compoundStarts.set(compound.id, segments[0].id);
      segments.forEach((segment) => topLevelOf.set(segment.id, compound.id));
      waits.set(compound.id, waitTimes(line));
    } else {
      const atomic = atomicFrom(line, index, cursor, tally);
      paths.push(atomic);
      topLevelOf.set(atomic.id, atomic.id);
      waits.set(atomic.id, waitTimes(line));
      cursor = atomic.end;
    }
  });
  if (tally.converted) warnings.push(throughWarning(tally));

  const routine: Step[] = [];
  const pushPath = (pathId: string) => {
    const wait = waits.get(pathId);
    if (wait && wait.before > 0) routine.push(waitStep(wait.before));
    routine.push({ id: newId("step"), kind: "path", pathId });
    if (wait && wait.after > 0) routine.push(waitStep(wait.after));
  };
  if (Array.isArray(data.sequence) && data.sequence.length) {
    let lastPath: string | null = null;
    for (const item of data.sequence.filter(isObject)) {
      if (item.kind === "wait") {
        routine.push(waitStep(Math.max(0, num(item.durationMs))));
        lastPath = null;
      } else if (item.kind === "path") {
        const lineId = str(item.lineId);
        const topLevel = topLevelOf.get(lineId);
        if (!topLevel) {
          warnings.push("A sequence entry refers to a path that is not in the file and was skipped.");
          continue;
        }
        // One complete group is one routine step. A repeated atomic path or a new pass
        // through the group must remain a separate step.
        if (topLevel === lastPath && lineId !== topLevel && lineId !== compoundStarts.get(topLevel)) continue;
        pushPath(topLevel);
        lastPath = topLevel;
      }
    }
  } else {
    paths.forEach((path) => pushPath(path.id));
  }
  return { start, paths, routine, warnings };
}

function waitTimes(line: Json) {
  const before = isObject(line.waitBefore) ? num(line.waitBefore.durationMs) : 0;
  const after = isObject(line.waitAfter) ? num(line.waitAfter.durationMs) : 0;
  return {
    before: Math.max(0, num(line.waitBeforeMs, before)),
    after: Math.max(0, num(line.waitAfterMs, after)),
  };
}

function headingStartDegrees(heading: Heading): number {
  switch (heading.type) {
    case "linear": return heading.startDeg;
    case "constant": return heading.degrees;
    default: return 0;
  }
}

function compareVersions(a: string, b: string) {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

function headingTo(heading: Heading): Json {
  switch (heading.type) {
    case "linear": return { type: "linear", startDeg: heading.startDeg, endDeg: heading.endDeg };
    case "constant": return { type: "constant", degrees: heading.degrees };
    case "tangential": return { type: "tangential", reverse: heading.reverse };
    case "piecewise":
      return {
        type: "piecewise",
        piecewiseHeading: {
          segments: heading.segments.map((segment) => {
            const base = { startProgress: segment.startProgress, endProgress: segment.endProgress };
            switch (segment.type) {
              case "linear": return { ...base, interpolationType: "linear", parameters: { startDeg: segment.startDeg, endDeg: segment.endDeg } };
              case "constant": return { ...base, interpolationType: "constant", parameters: { degrees: segment.degrees } };
              case "tangential": return { ...base, interpolationType: "tangential", reversed: segment.reverse };
              case "facingPoint": return { ...base, interpolationType: "facing-point", parameters: { point: { ...segment.point } } };
            }
          }),
        },
      };
  }
}

function atomicTo(path: AtomicPath): Json {
  return {
    kind: "atomic",
    id: path.id,
    color: path.color,
    name: path.name,
    endPoint: { ...path.end },
    controlPoints: path.controlPoints.map((control) => ({ ...control })),
    heading: headingTo(path.heading),
    waitBeforeMs: 0,
    waitAfterMs: 0,
    waitBeforeName: "",
    waitAfterName: "",
  };
}

export interface ExportOptions {
  /**
   * The project's robot. Its size is written as the file's `robot` block; the Visualizer fills the
   * settings the block leaves out from its own.
   */
  robot?: RobotSize;
  /** The save time written to the file. */
  now?: Date;
}

export interface ExportedPaths {
  text: string;
  warnings: string[];
}

/** Writes a Visualizer 2.0.0 `.pp` file for an autonomous program's paths and waits. */
export function exportVisualizer(program: { start: StartPose; paths: PathDoc[]; routine: Step[] }, options: ExportOptions = {}): ExportedPaths {
  const { robot, now = new Date() } = options;
  const warnings: string[] = [];
  const lines = program.paths.map((path) => path.kind === "atomic" ? atomicTo(path) : {
    kind: "compound",
    id: path.id,
    color: path.color,
    name: path.name,
    segments: path.segments.map(atomicTo),
    ...(path.heading ? { heading: headingTo(path.heading) } : {}),
    waitBeforeMs: 0,
    waitAfterMs: 0,
    waitBeforeName: "",
    waitAfterName: "",
  });
  const sequence: Json[] = [];
  let skippedMechanism = false;
  let flattenedGroup = false;
  const visit = (steps: Step[]) => {
    for (const step of steps) {
      switch (step.kind) {
        case "path": {
          const path = program.paths.find((item) => item.id === step.pathId);
          if (!path) break;
          const ids = path.kind === "atomic" ? [path.id] : path.segments.map((segment) => segment.id);
          ids.forEach((lineId) => sequence.push({ kind: "path", lineId }));
          break;
        }
        case "wait":
          sequence.push({ kind: "wait", id: step.id, name: "", durationMs: step.ms });
          break;
        case "state":
          skippedMechanism = true;
          break;
        case "together":
        case "race":
          flattenedGroup = true;
          visit(step.steps);
          break;
      }
    }
  };
  visit(program.routine);
  if (skippedMechanism) warnings.push("Mechanism steps were left out because the Visualizer has no equivalent.");
  if (flattenedGroup) warnings.push("Steps that run at the same time were written in order because the Visualizer runs one step at a time.");
  const document = {
    version: VISUALIZER_VERSION,
    timestamp: now.toISOString(),
    startPoint: { x: program.start.x, y: program.start.y, headingDeg: program.start.headingDeg },
    lines,
    shapes: [],
    sequence,
    ...(robot ? { robot: { rLength: robot.lengthInches, rWidth: robot.widthInches } } : {}),
  };
  return { text: `${JSON.stringify(document, null, 2)}\n`, warnings };
}
