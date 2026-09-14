import type { AtomicPath, AutonomousProgram, PathDoc, Point } from "../ir/types";
import { CompoundCurve, curveBetween, type Curve } from "./curves";
import { headingAt } from "./headings";

export interface Pose extends Point {
  /** Radians in [0, 2π). */
  heading: number;
}

/** A path resolved to geometry, with its start taken from the previous path. */
export interface ResolvedPath {
  doc: PathDoc;
  start: Point;
  end: Point;
  curve: Curve;
  /** Pose at parameter t in [0, 1]. */
  poseAt(t: number): Pose;
}

function resolveAtomic(doc: AtomicPath, start: Point): { curve: Curve; heading: (t: number) => number } {
  if (!doc.controlPoints.length && doc.end.x === start.x && doc.end.y === start.y) {
    throw new Error(`Path "${doc.name || doc.id}" has zero length.`);
  }
  const curve = curveBetween(start, doc.controlPoints, doc.end);
  if (!(curve.length > 0)) throw new Error(`Path "${doc.name || doc.id}" has zero length.`);
  return { curve, heading: (t) => headingAt(doc.heading, curve, t) };
}

/**
 * Resolves one path starting at `start`. Throws when the geometry cannot be followed, such as a
 * zero-length line; use `validateProject` to report those problems to the user first.
 */
export function resolvePath(doc: PathDoc, start: Point): ResolvedPath {
  if (doc.kind === "atomic") {
    const { curve, heading } = resolveAtomic(doc, start);
    return { doc, start, end: doc.end, curve, poseAt: (t) => ({ ...curve.get(t), heading: heading(t) }) };
  }
  const parts: { curve: Curve; heading: (t: number) => number }[] = [];
  let segmentStart = start;
  for (const segment of doc.segments) {
    parts.push(resolveAtomic(segment, segmentStart));
    segmentStart = segment.end;
  }
  const curve = new CompoundCurve(parts.map((part) => part.curve));
  const sharedHeading = doc.heading;
  const heading = (t: number): number => {
    if (sharedHeading) return headingAt(sharedHeading, curve, t);
    // Each segment keeps its own heading: find the segment and its local parameter by length.
    let startT = 0;
    for (let i = 0; i < parts.length; i++) {
      const width = parts[i].curve.length / curve.length;
      if (t < startT + width || i === parts.length - 1) {
        const local = width > 0 ? Math.min(1, Math.max(0, (t - startT) / width)) : 0;
        return parts[i].heading(local);
      }
      startT += width;
    }
    return 0;
  };
  return { doc, start, end: segmentStart, curve, poseAt: (t) => ({ ...curve.get(t), heading: heading(t) }) };
}

/** Resolves an autonomous program's paths in order. Stops at the first path that cannot be resolved. */
export function resolveProgramPaths(program: AutonomousProgram): { paths: ResolvedPath[]; error: string | null } {
  const paths: ResolvedPath[] = [];
  let start: Point = program.start;
  for (const doc of program.paths) {
    try {
      const resolved = resolvePath(doc, start);
      paths.push(resolved);
      start = resolved.end;
    } catch (error) {
      return { paths, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { paths, error: null };
}

/** Evenly spaced points along a path, for drawing. */
export function samplePath(path: ResolvedPath, count = 64): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= count; i++) points.push(path.curve.get(i / count));
  return points;
}
