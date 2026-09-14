import { newId, pathColor } from "../ir/create";
import type { AtomicPath, Heading, HeadingSegment, PathDoc, Point, StartPose, Step } from "../ir/types";
import { tangentAngle, toDegrees } from "../geometry/curves";
import { resolvePath } from "../geometry/paths";

/**
 * Reads and writes Pedro Pathing Visualizer `.pp` files. Version 1.5.0 and the earlier format that
 * stored headings on end points are both read; 1.5.0 is written.
 *
 * The Visualizer's shapes, field points, and display settings have no equivalent in a robot program
 * and are not imported. Mechanism steps and step groups have no `.pp` equivalent and are left out
 * when exporting; both cases are reported as warnings.
 */

export const VISUALIZER_VERSION = "1.5.0";

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

function point(value: unknown): Point {
  const source = isObject(value) ? value : {};
  return { x: num(source.x), y: num(source.y) };
}

function legacyHeading(source: Json): Heading {
  switch (source.heading) {
    case "linear": return { type: "linear", startDeg: num(source.startDeg), endDeg: num(source.endDeg) };
    case "constant": return { type: "constant", degrees: num(source.degrees) };
    case "tangential": return { type: "tangential", reverse: source.reverse === true };
    case "piecewise": return isObject(source.piecewiseHeading) ? piecewiseFrom(source.piecewiseHeading, null) : { type: "tangential", reverse: false };
    default: return { type: "tangential", reverse: false };
  }
}

/** A resolver for "continue from previous" angles, which depend on the path's geometry. */
type AngleAtProgress = (progress: number) => number;

function piecewiseFrom(value: Json, angleAt: AngleAtProgress | null): Heading {
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
    previousEnd = segmentEndDegrees(segment, angleAt);
  }
  return segments.length ? { type: "piecewise", segments } : { type: "tangential", reverse: false };
}

function segmentEndDegrees(segment: HeadingSegment, angleAt: AngleAtProgress | null): number | null {
  switch (segment.type) {
    case "linear": return segment.endDeg;
    case "constant": return segment.degrees;
    default: return angleAt ? angleAt(segment.endProgress) : null;
  }
}

function headingFrom(line: Json, angleAt: AngleAtProgress | null): Heading {
  const heading = line.heading;
  if (isObject(heading) && typeof heading.type === "string") {
    switch (heading.type) {
      case "linear": return { type: "linear", startDeg: num(heading.startDeg), endDeg: num(heading.endDeg) };
      case "constant": return { type: "constant", degrees: num(heading.degrees) };
      case "tangential": return { type: "tangential", reverse: heading.reverse === true };
      case "piecewise": return isObject(heading.piecewiseHeading) ? piecewiseFrom(heading.piecewiseHeading, angleAt) : { type: "tangential", reverse: false };
    }
  }
  const endPoint = isObject(line.endPoint) ? line.endPoint : {};
  return legacyHeading(typeof heading === "string" ? { ...endPoint, heading } : endPoint);
}

function atomicFrom(line: Json, index: number, start: Point): AtomicPath {
  const end = point(line.endPoint);
  const controlPoints = Array.isArray(line.controlPoints) ? line.controlPoints.map(point) : [];
  const doc: AtomicPath = {
    id: str(line.id) || newId("path"),
    name: str(line.name),
    color: str(line.color) || pathColor(index),
    kind: "atomic",
    end,
    controlPoints,
    heading: { type: "tangential", reverse: false },
  };
  // Headings that continue from a tangential segment need the curve to resolve their start angle.
  let angleAt: AngleAtProgress | null = null;
  try {
    const resolved = resolvePath(doc, start);
    angleAt = (progress) => {
      const t = resolved.curve.parameter(progress);
      return toDegrees(tangentAngle(resolved.curve, t));
    };
  } catch {
    angleAt = null;
  }
  doc.heading = headingFrom(line, angleAt);
  return doc;
}

function waitStep(ms: number): Step {
  return { id: newId("step"), kind: "wait", ms };
}

/** Parses `.pp` file text. Throws with a readable message when the file is not a Visualizer project. */
export function importVisualizer(text: string): ImportedPaths {
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

  const startSource = isObject(data.startPoint) ? data.startPoint : {};
  const startHeading = typeof startSource.headingDeg === "number"
    ? startSource.headingDeg
    : headingStartDegrees(legacyHeading(startSource));
  const start: StartPose = { x: num(startSource.x), y: num(startSource.y), headingDeg: startHeading };

  const paths: PathDoc[] = [];
  const waits = new Map<string, { before: number; after: number }>();
  const topLevelOf = new Map<string, string>();
  let cursor: Point = start;
  data.lines.filter(isObject).forEach((line, index) => {
    const color = str(line.color) || pathColor(index);
    if (Array.isArray(line.segments)) {
      const segments: AtomicPath[] = [];
      for (const [segmentIndex, segment] of line.segments.filter(isObject).entries()) {
        const atomic = atomicFrom(segment, index + segmentIndex, cursor);
        segments.push(atomic);
        cursor = atomic.end;
      }
      const compound: PathDoc = {
        id: str(line.id) || newId("path"),
        name: str(line.name),
        color,
        kind: "compound",
        segments,
        heading: isObject(line.heading) ? headingFrom(line, null) : null,
      };
      if (!segments.length) {
        warnings.push(`An empty path group "${compound.name}" was skipped.`);
        return;
      }
      paths.push(compound);
      topLevelOf.set(compound.id, compound.id);
      segments.forEach((segment) => topLevelOf.set(segment.id, compound.id));
      waits.set(compound.id, waitTimes(line));
    } else {
      const atomic = atomicFrom(line, index, cursor);
      paths.push(atomic);
      topLevelOf.set(atomic.id, atomic.id);
      waits.set(atomic.id, waitTimes(line));
      cursor = atomic.end;
    }
  });

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
        const topLevel = topLevelOf.get(str(item.lineId));
        if (!topLevel) {
          warnings.push("A sequence entry refers to a path that is not in the file and was skipped.");
          continue;
        }
        if (topLevel === lastPath) continue;
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

export interface ExportedPaths {
  text: string;
  warnings: string[];
}

/** Writes a Visualizer 1.5.0 `.pp` file for an autonomous program's paths and waits. */
export function exportVisualizer(program: { start: StartPose; paths: PathDoc[]; routine: Step[] }, now = new Date()): ExportedPaths {
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
  };
  return { text: `${JSON.stringify(document, null, 2)}\n`, warnings };
}
