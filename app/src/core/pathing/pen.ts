/**
 * Turns a freehand pen stroke into one smooth path.
 *
 * Adapted from the Pedro Pathing Visualizer's `src/lib/pen/strokeFitting.ts`
 * (https://github.com/Pedro-Pathing/Visualizer), licensed under the Apache License 2.0.
 * Modified by The Lumière Contributors: it returns Lumière path geometry, writing the stroke's
 * through points as the Bezier control points of the same curve.
 */
import type { Point } from "../ir/types";
import { throughControlPoints } from "../pp/visualizer";
import { clampToFloor } from "./field";

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
/** Most points a fitted stroke keeps, counting both ends, as in the Visualizer. */
export const PEN_MAX_VERTICES = 12;

/** Drops samples closer than `minDistance` to the previous kept one. */
export function dedupeStroke(points: Point[], minDistance: number): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    const last = kept[kept.length - 1];
    if (!last || distance(last, point) >= minDistance) kept.push({ x: point.x, y: point.y });
  }
  return kept;
}

function pointAlong(points: Point[], target: number): Point {
  let remaining = target;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const length = distance(current, next);
    if (length === 0) continue;
    if (remaining <= length) return { x: current.x + ((next.x - current.x) * remaining) / length, y: current.y + ((next.y - current.y) * remaining) / length };
    remaining -= length;
  }
  return { ...points[points.length - 1] };
}

/** At most `maxVertices` points: the first and last, and the interior resampled evenly by distance. */
export function limitStrokeVertices(points: Point[], maxVertices: number): Point[] {
  if (points.length <= maxVertices || points.length <= 2) return points.map((point) => ({ ...point }));
  const total = points.reduce((sum, point, index) => (index === 0 ? 0 : sum + distance(points[index - 1], point)), 0);
  if (total === 0 || maxVertices <= 2) return [{ ...points[0] }, { ...points[points.length - 1] }];
  const interior = maxVertices - 2;
  const resampled = [{ ...points[0] }];
  for (let index = 1; index <= interior; index += 1) resampled.push(pointAlong(points, (total * index) / (interior + 1)));
  resampled.push({ ...points[points.length - 1] });
  return resampled;
}

/**
 * The stroke as one path from its first point (or from `anchor`, when it continues an existing
 * path) to its last, passing through the sampled points between. Null for a stroke too short to drive.
 */
export function fitStroke(stroke: Point[], anchor?: Point): { start: Point; end: Point; controlPoints: Point[] } | null {
  const cleaned = dedupeStroke(stroke.map((point) => ({ x: clampToFloor(point.x), y: clampToFloor(point.y) })), 0.2);
  const points = limitStrokeVertices(anchor ? [{ x: clampToFloor(anchor.x), y: clampToFloor(anchor.y) }, ...cleaned] : cleaned, PEN_MAX_VERTICES);
  if (points.length < 2) return null;
  const start = points[0];
  const end = points[points.length - 1];
  if (distance(start, end) < 1 && points.length < 3) return null;
  const round = (point: Point) => ({ x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 });
  return { start: round(start), end: round(end), controlPoints: throughControlPoints(start, points.slice(1, -1), end).map(round) };
}
