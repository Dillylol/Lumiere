/**
 * Mirrors an autonomous program to the other alliance.
 *
 * Adapted from the Pedro Pathing Visualizer's `src/model/mirror.ts`
 * (https://github.com/Pedro-Pathing/Visualizer), licensed under the Apache License 2.0.
 * Modified by The Lumière Contributors: it works on Lumière's programs and normalizes mirrored
 * angles to 0–360°. Like the Visualizer, it mirrors across x = 70.75, the middle of the floor.
 */
import type { AutonomousProgram, Heading, HeadingSegment, PathDoc, Point } from "../ir/types";
import { FIELD_FLOOR_INCHES } from "./field";

/** Pedro's `PoseFactory.mirrorX(axis)` reflects across x = axis: x → 2·axis − x and heading → 180° − heading. */
export const MIRROR_AXIS = FIELD_FLOOR_INCHES / 2;

export function mirrorAngle(degrees: number): number {
  const mirrored = (180 - degrees) % 360;
  return mirrored < 0 ? mirrored + 360 : mirrored;
}

function mirrorPoint<T extends Point>(point: T, axis: number): T {
  return { ...point, x: 2 * axis - point.x };
}

function mirrorSegment(segment: HeadingSegment, axis: number): HeadingSegment {
  switch (segment.type) {
    case "linear": return { ...segment, startDeg: mirrorAngle(segment.startDeg), endDeg: mirrorAngle(segment.endDeg) };
    case "constant": return { ...segment, degrees: mirrorAngle(segment.degrees) };
    case "facingPoint": return { ...segment, point: mirrorPoint(segment.point, axis) };
    // The tangent is mirrored with the path, so facing along it still holds.
    case "tangential": return segment;
  }
}

export function mirrorHeading(heading: Heading, axis = MIRROR_AXIS): Heading {
  switch (heading.type) {
    case "linear": return { ...heading, startDeg: mirrorAngle(heading.startDeg), endDeg: mirrorAngle(heading.endDeg) };
    case "constant": return { ...heading, degrees: mirrorAngle(heading.degrees) };
    case "tangential": return heading;
    case "piecewise": return { ...heading, segments: heading.segments.map((segment) => mirrorSegment(segment, axis)) };
  }
}

function mirrorPath(path: PathDoc, axis: number): PathDoc {
  if (path.kind === "compound") {
    return {
      ...path,
      heading: path.heading && mirrorHeading(path.heading, axis),
      segments: path.segments.map((segment) => mirrorPath(segment, axis) as typeof segment),
    };
  }
  return {
    ...path,
    heading: mirrorHeading(path.heading, axis),
    end: mirrorPoint(path.end, axis),
    controlPoints: path.controlPoints.map((point) => mirrorPoint(point, axis)),
  };
}

/** The program reflected across the field's vertical center line: its start pose, paths and headings. */
export function mirrorProgram(program: AutonomousProgram, axis = MIRROR_AXIS): AutonomousProgram {
  return {
    ...program,
    start: { ...mirrorPoint(program.start, axis), headingDeg: mirrorAngle(program.start.headingDeg) },
    paths: program.paths.map((path) => mirrorPath(path, axis)),
  };
}
