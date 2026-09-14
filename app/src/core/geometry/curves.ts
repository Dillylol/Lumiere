import type { Point } from "../ir/types";

/** Normalizes an angle in radians to [0, 2π), as Pedro Pathing's `Angle.normalize` does. */
export function normalizeAngle(radians: number): number {
  const angle = radians % (2 * Math.PI);
  return angle < 0 ? angle + 2 * Math.PI : angle;
}

/** Normalizes an angle in radians to [-π, π), as Pedro Pathing's `Angle.normalizeSigned` does. */
export function normalizeSignedAngle(radians: number): number {
  const angle = normalizeAngle(radians);
  return angle >= Math.PI ? angle - 2 * Math.PI : angle;
}

/** The shortest signed turn from `current` to `target`, as Pedro Pathing's `Angle.error` does. */
export function angleError(current: number, target: number): number {
  return normalizeSignedAngle(target - current);
}

export const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
export const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/**
 * A parametric curve, t in [0, 1]. Mirrors Pedro Pathing's `Curve` for straight lines, Bezier curves,
 * and compound curves, so previews match what the follower receives.
 */
export interface Curve {
  readonly length: number;
  get(t: number): Point;
  derivative(t: number): Point;
  /** Distance left to travel from parameter t to the end. */
  remainingDistance(t: number): number;
  /** Parameter at a fraction of the length travelled. */
  parameter(completion: number): number;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Fraction of the length travelled at parameter t, 0 at the start and 1 at the end. */
export function completion(curve: Curve, t: number): number {
  if (!(curve.length > 0)) return 0;
  return clamp(1 - curve.remainingDistance(t) / curve.length, 0, 1);
}

/** Direction of travel at parameter t, in radians in (-π, π]. Zero when the curve is degenerate. */
export function tangentAngle(curve: Curve, t: number): number {
  const d = curve.derivative(t);
  if (Math.hypot(d.x, d.y) < 1e-9) return 0;
  return Math.atan2(d.y, d.x);
}

export class LineCurve implements Curve {
  readonly length: number;

  constructor(readonly start: Point, readonly end: Point) {
    this.length = distance(start, end);
  }

  get(t: number): Point {
    return { x: this.start.x + (this.end.x - this.start.x) * t, y: this.start.y + (this.end.y - this.start.y) * t };
  }

  derivative(): Point {
    return { x: this.end.x - this.start.x, y: this.end.y - this.start.y };
  }

  remainingDistance(t: number): number {
    return (1 - t) * this.length;
  }

  parameter(fraction: number): number {
    return fraction;
  }
}

/** Sorted numeric keys with linear interpolation, like Pedro Pathing's `BijectiveMap`. */
class InterpolatingTable {
  private readonly keys: number[] = [];
  private readonly values: number[] = [];

  put(key: number, value: number) {
    let low = 0;
    let high = this.keys.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.keys[mid] < key) low = mid + 1;
      else high = mid;
    }
    if (this.keys[low] === key) {
      this.values[low] = value;
      return;
    }
    this.keys.splice(low, 0, key);
    this.values.splice(low, 0, value);
  }

  get(key: number): number | undefined {
    const index = this.indexOf(key);
    return this.keys[index] === key ? this.values[index] : undefined;
  }

  private indexOf(key: number): number {
    let low = 0;
    let high = this.keys.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.keys[mid] < key) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  interpolate(key: number): number {
    if (!this.keys.length) return Number.NaN;
    const upper = this.indexOf(key);
    if (upper < this.keys.length && this.keys[upper] === key) return this.values[upper];
    if (upper === 0) return this.values[0];
    if (upper >= this.keys.length) return this.values[this.keys.length - 1];
    const lowerKey = this.keys[upper - 1];
    const upperKey = this.keys[upper];
    const lowerValue = this.values[upper - 1];
    const upperValue = this.values[upper];
    return lowerValue + (upperValue - lowerValue) * ((key - lowerKey) / (upperKey - lowerKey));
  }
}

export class BezierCurve implements Curve {
  private static readonly SUBDIVISION_TOLERANCE = 1e-5;
  private static readonly MAX_SUBDIVISION_DEPTH = 15;
  readonly length: number;
  private readonly forward = new InterpolatingTable();
  private readonly reverse = new InterpolatingTable();

  /** @param points start point, one or more control points, and end point */
  constructor(readonly points: readonly Point[]) {
    if (points.length < 3) throw new Error("A Bezier curve needs a start, an end, and at least one control point.");
    this.put(0, 0);
    this.subdivide(0, 1, this.get(0), this.get(1), 0);
    this.length = this.forward.get(1) ?? 0;
  }

  private put(t: number, travelled: number) {
    this.forward.put(t, travelled);
    this.reverse.put(travelled, t);
  }

  private subdivide(startT: number, endT: number, startPoint: Point, endPoint: Point, depth: number) {
    const midT = (startT + endT) / 2;
    const midPoint = this.get(midT);
    const chord = distance(startPoint, endPoint);
    const split = distance(startPoint, midPoint) + distance(midPoint, endPoint);
    if (Math.abs(split - chord) < BezierCurve.SUBDIVISION_TOLERANCE || depth >= BezierCurve.MAX_SUBDIVISION_DEPTH) {
      const base = this.forward.get(startT) ?? 0;
      this.put(midT, base + distance(startPoint, midPoint));
      this.put(endT, base + split);
      return;
    }
    this.subdivide(startT, midT, startPoint, midPoint, depth + 1);
    this.subdivide(midT, endT, midPoint, endPoint, depth + 1);
  }

  get(t: number): Point {
    // de Casteljau's algorithm.
    const xs = this.points.map((p) => p.x);
    const ys = this.points.map((p) => p.y);
    for (let level = 1; level < xs.length; level++) {
      for (let i = 0; i < xs.length - level; i++) {
        xs[i] = xs[i] + (xs[i + 1] - xs[i]) * t;
        ys[i] = ys[i] + (ys[i + 1] - ys[i]) * t;
      }
    }
    return { x: xs[0], y: ys[0] };
  }

  derivative(t: number): Point {
    const n = this.points.length - 1;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      xs.push(n * (this.points[i + 1].x - this.points[i].x));
      ys.push(n * (this.points[i + 1].y - this.points[i].y));
    }
    for (let level = 1; level < xs.length; level++) {
      for (let i = 0; i < xs.length - level; i++) {
        xs[i] = xs[i] + (xs[i + 1] - xs[i]) * t;
        ys[i] = ys[i] + (ys[i + 1] - ys[i]) * t;
      }
    }
    return { x: xs[0], y: ys[0] };
  }

  private travelledFraction(t: number): number {
    if (!(this.length > 0)) return 0;
    return clamp(this.forward.interpolate(t) / this.length, 0, 1);
  }

  remainingDistance(t: number): number {
    return (1 - this.travelledFraction(t)) * this.length;
  }

  parameter(fraction: number): number {
    return this.reverse.interpolate(fraction * this.length);
  }
}

/** Curves joined end to end, parameterized by length like Pedro Pathing's `CompoundCurve`. */
export class CompoundCurve implements Curve {
  readonly length: number;
  private readonly starts: number[] = [];

  constructor(readonly curves: readonly Curve[]) {
    if (!curves.length) throw new Error("A compound curve needs at least one curve.");
    this.length = curves.reduce((sum, curve) => sum + curve.length, 0);
    let current = 0;
    for (const curve of curves) {
      this.starts.push(current);
      current += curve.length / this.length;
    }
  }

  private segmentIndex(t: number): number {
    let index = 0;
    for (let i = 0; i < this.starts.length; i++) {
      if (this.starts[i] <= t) index = i;
    }
    return index;
  }

  private localT(t: number): { curve: Curve; t: number } {
    const index = this.segmentIndex(t);
    const curve = this.curves[index];
    return { curve, t: ((t - this.starts[index]) / curve.length) * this.length };
  }

  get(t: number): Point {
    const local = this.localT(t);
    return local.curve.get(local.t);
  }

  derivative(t: number): Point {
    const local = this.localT(t);
    return local.curve.derivative(local.t);
  }

  remainingDistance(t: number): number {
    let travelled = 0;
    let cumulative = 0;
    for (const curve of this.curves) {
      const currentT = cumulative / this.length;
      const nextT = (cumulative + curve.length) / this.length;
      if (t <= currentT) break;
      if (t >= nextT) {
        travelled += curve.length;
      } else {
        const local = this.localT(t);
        travelled += curve.length - curve.remainingDistance(local.t);
        break;
      }
      cumulative += curve.length;
    }
    return this.length - travelled;
  }

  parameter(fraction: number): number {
    const target = fraction * this.length;
    if (target <= 0) return 0;
    if (target >= this.length) return 1;
    let remaining = target;
    for (let i = 0; i < this.curves.length; i++) {
      const curve = this.curves[i];
      if (remaining <= curve.length) {
        const localT = curve.parameter(remaining / curve.length);
        return this.starts[i] + (localT * curve.length) / this.length;
      }
      remaining -= curve.length;
    }
    return 1;
  }
}

/** A line when there are no control points, otherwise a Bezier curve. */
export function curveBetween(start: Point, controlPoints: readonly Point[], end: Point): Curve {
  return controlPoints.length ? new BezierCurve([start, ...controlPoints, end]) : new LineCurve(start, end);
}
