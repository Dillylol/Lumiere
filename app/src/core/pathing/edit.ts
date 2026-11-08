/**
 * Edits an autonomous program's paths the way the field editor needs them. Every function returns
 * a new program and leaves its argument alone, so a drag can preview edits and commit once.
 */
import { createLine, newId } from "../ir/create";
import { resolveProgramPaths } from "../geometry/paths";
import { toDegrees } from "../geometry/curves";
import type { AtomicPath, AutonomousProgram, Heading, PathDoc, Point, Step } from "../ir/types";
import { snapToGrid } from "./field";
import { fitStroke } from "./pen";

/** A point on the field that can be dragged. */
export type PointRef =
  | { kind: "start" }
  | { kind: "end"; pathId: string }
  | { kind: "control"; pathId: string; index: number };

/** Keeps a point on the floor, snapped to a grid of `grid` inches aligned to the tile seams, or to a tenth of an inch. */
export const snapPoint = snapToGrid;

const mapPath = (program: AutonomousProgram, pathId: string, change: (path: PathDoc) => PathDoc): AutonomousProgram =>
  ({ ...program, paths: program.paths.map((path) => path.id === pathId ? change(path) : path) });

/** Where the robot ends up and which way it faces after the program's last path, in degrees. */
export function endPose(program: AutonomousProgram): { point: Point; headingDeg: number } {
  const { paths } = resolveProgramPaths(program);
  const last = paths[paths.length - 1];
  if (!last) return { point: { x: program.start.x, y: program.start.y }, headingDeg: program.start.headingDeg };
  return { point: last.end, headingDeg: Math.round(toDegrees(last.poseAt(1).heading) * 10) / 10 };
}

/** Appends a straight path to `end` that keeps the robot's heading, and drives it at the end of the routine. */
export function addPath(program: AutonomousProgram, end: Point): { program: AutonomousProgram; pathId: string } {
  const { headingDeg } = endPose(program);
  const path = createLine(end, headingDeg, headingDeg, program.paths.length, `Path ${program.paths.length + 1}`);
  return {
    pathId: path.id,
    program: { ...program, paths: [...program.paths, path], routine: [...program.routine, { id: newId("step"), kind: "path", pathId: path.id }] },
  };
}

export function pointAt(program: AutonomousProgram, ref: PointRef): Point | undefined {
  if (ref.kind === "start") return program.start;
  const path = program.paths.find((item) => item.id === ref.pathId);
  if (!path || path.kind !== "atomic") return undefined;
  return ref.kind === "end" ? path.end : path.controlPoints[ref.index];
}

export function movePoint(program: AutonomousProgram, ref: PointRef, point: Point): AutonomousProgram {
  if (ref.kind === "start") return { ...program, start: { ...program.start, x: point.x, y: point.y } };
  return mapPath(program, ref.pathId, (path) => {
    if (path.kind !== "atomic") return path;
    if (ref.kind === "end") return { ...path, end: { ...point } };
    return { ...path, controlPoints: path.controlPoints.map((control, index) => index === ref.index ? { ...point } : control) };
  });
}

/** Adds a curve handle between the last handle (or the path's start) and its end, set off to one side. */
export function insertControlPoint(program: AutonomousProgram, pathId: string): AutonomousProgram {
  const index = program.paths.findIndex((path) => path.id === pathId);
  const path = program.paths[index];
  if (!path || path.kind !== "atomic" || path.controlPoints.length >= 16) return program;
  const before = resolveProgramPaths({ ...program, paths: program.paths.slice(0, index) }).paths;
  const start = index === 0 ? program.start : before[before.length - 1]?.end ?? program.start;
  const from = path.controlPoints[path.controlPoints.length - 1] ?? start;
  const dx = path.end.x - from.x;
  const dy = path.end.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const offset = Math.min(12, length / 3);
  const point = snapPoint({ x: (from.x + path.end.x) / 2 - (dy / length) * offset, y: (from.y + path.end.y) / 2 + (dx / length) * offset }, 0);
  return mapPath(program, pathId, (item) => item.kind === "atomic" ? { ...item, controlPoints: [...item.controlPoints, point] } : item);
}

export function removeControlPoint(program: AutonomousProgram, pathId: string, index: number): AutonomousProgram {
  return mapPath(program, pathId, (path) => path.kind === "atomic" ? { ...path, controlPoints: path.controlPoints.filter((_, i) => i !== index) } : path);
}

function withoutPath(steps: Step[], pathId: string): Step[] {
  return steps
    .filter((step) => step.kind !== "path" || step.pathId !== pathId)
    .map((step) => "steps" in step ? { ...step, steps: withoutPath(step.steps, pathId) } : step);
}

/** Removes a path and every routine step that drives it. */
export function deletePath(program: AutonomousProgram, pathId: string): AutonomousProgram {
  return { ...program, paths: program.paths.filter((path) => path.id !== pathId), routine: withoutPath(program.routine, pathId) };
}

/** Moves a path earlier or later in the list; each path starts where the one before it ends. */
export function movePath(program: AutonomousProgram, pathId: string, by: number): AutonomousProgram {
  const from = program.paths.findIndex((path) => path.id === pathId);
  const to = from + by;
  if (from < 0 || to < 0 || to >= program.paths.length) return program;
  const paths = [...program.paths];
  const [path] = paths.splice(from, 1);
  paths.splice(to, 0, path);
  return { ...program, paths };
}

export function updatePath(program: AutonomousProgram, pathId: string, patch: Partial<Pick<AtomicPath, "name" | "color">>): AutonomousProgram {
  return mapPath(program, pathId, (path) => ({ ...path, ...patch }));
}

export function setHeading(program: AutonomousProgram, pathId: string, heading: Heading): AutonomousProgram {
  return mapPath(program, pathId, (path) => path.kind === "atomic" ? { ...path, heading } : { ...path, heading });
}

/** The top-level routine step that drives a path, or -1. */
const pathStepIndex = (program: AutonomousProgram, pathId: string) =>
  program.routine.findIndex((step) => step.kind === "path" && step.pathId === pathId);

/** How long the routine waits right after driving a path, in milliseconds. */
export function waitAfter(program: AutonomousProgram, pathId: string): number {
  const next = program.routine[pathStepIndex(program, pathId) + 1];
  return pathStepIndex(program, pathId) >= 0 && next?.kind === "wait" ? next.ms : 0;
}

/** Sets the wait right after a path, adding, changing or removing the routine's wait step. */
export function setWaitAfter(program: AutonomousProgram, pathId: string, ms: number): AutonomousProgram {
  const index = pathStepIndex(program, pathId);
  if (index < 0) return program;
  const routine = [...program.routine];
  const next = routine[index + 1];
  if (next?.kind === "wait") {
    if (ms > 0) routine[index + 1] = { ...next, ms };
    else routine.splice(index + 1, 1);
  } else if (ms > 0) {
    routine.splice(index + 1, 0, { id: newId("step"), kind: "wait", ms } as Step);
  }
  return { ...program, routine };
}

/**
 * Adds a path drawn with the pen. It continues from where the routine ends, or sets the start pose
 * when the program has no paths yet, and faces along the stroke. Null when the stroke is too short.
 */
export function addPenPath(program: AutonomousProgram, stroke: Point[]): { program: AutonomousProgram; pathId: string } | null {
  const first = program.paths.length === 0;
  const fitted = fitStroke(stroke, first ? undefined : endPose(program).point);
  if (!fitted) return null;
  const path: AtomicPath = {
    ...createLine(fitted.end, 0, 0, program.paths.length, `Path ${program.paths.length + 1}`),
    controlPoints: fitted.controlPoints,
    heading: { type: "tangential", reverse: false },
  };
  return {
    pathId: path.id,
    program: {
      ...program,
      start: first ? { ...program.start, x: fitted.start.x, y: fitted.start.y } : program.start,
      paths: [...program.paths, path],
      routine: [...program.routine, { id: newId("step"), kind: "path", pathId: path.id }],
    },
  };
}
