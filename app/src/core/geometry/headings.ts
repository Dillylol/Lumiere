import type { Heading, HeadingSegment } from "../ir/types";
import { angleError, completion, normalizeAngle, tangentAngle, toRadians, type Curve } from "./curves";

/**
 * Heading in radians, in [0, 2π), at parameter t.
 *
 * Linear and piecewise headings measure progress by distance travelled, matching the robot library's
 * `Headings` interpolators that generated code uses. (Pedro Pathing 3.0.0's own `Path.linear` turns
 * backwards on straight lines; see docs/compatibility.md.)
 */
export function headingAt(heading: Heading, curve: Curve, t: number): number {
  switch (heading.type) {
    case "linear":
      return linearHeading(heading.startDeg, heading.endDeg, completion(curve, t));
    case "constant":
      return normalizeAngle(toRadians(heading.degrees));
    case "tangential":
      return normalizeAngle(tangentAngle(curve, t) + (heading.reverse ? Math.PI : 0));
    case "piecewise":
      return piecewiseHeading(heading.segments, curve, t);
  }
}

function linearHeading(startDeg: number, endDeg: number, fraction: number): number {
  const start = normalizeAngle(toRadians(startDeg));
  const delta = angleError(start, normalizeAngle(toRadians(endDeg)));
  return normalizeAngle(start + delta * fraction);
}

/** The segment that applies at a completion fraction. Gaps use the nearest segment's boundary value. */
export function activeSegment(segments: readonly HeadingSegment[], fraction: number): { segment: HeadingSegment; local: number } {
  const sorted = [...segments].sort((a, b) => a.startProgress - b.startProgress);
  let chosen = sorted[sorted.length - 1];
  for (const segment of sorted) {
    if (fraction <= segment.endProgress) {
      chosen = segment;
      break;
    }
  }
  const width = chosen.endProgress - chosen.startProgress;
  const local = width > 0 ? Math.max(0, Math.min(1, (fraction - chosen.startProgress) / width)) : 1;
  return { segment: chosen, local };
}

function piecewiseHeading(segments: readonly HeadingSegment[], curve: Curve, t: number): number {
  const { segment, local } = activeSegment(segments, completion(curve, t));
  switch (segment.type) {
    case "linear":
      return linearHeading(segment.startDeg, segment.endDeg, local);
    case "constant":
      return normalizeAngle(toRadians(segment.degrees));
    case "tangential":
      return normalizeAngle(tangentAngle(curve, t) + (segment.reverse ? Math.PI : 0));
    case "facingPoint": {
      const position = curve.get(t);
      return normalizeAngle(Math.atan2(segment.point.y - position.y, segment.point.x - position.x));
    }
  }
}
