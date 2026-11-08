import { describe, expect, it } from "vitest";
import sample from "../../../../fixtures/projects/sample-robot.json";
import { createAutonomous, createLine, createProject } from "../ir/create";
import { parseProject } from "../ir/schema";
import type { AtomicPath, AutonomousProgram } from "../ir/types";
import { estimateRoutine } from "../motion/estimate";
import { addPath, deletePath, endPose, insertControlPoint, movePath, movePoint, removeControlPoint, snapPoint } from "./edit";
import { mirrorAngle, mirrorProgram } from "./mirror";

describe("mirrorProgram", () => {
  const program: AutonomousProgram = {
    ...createAutonomous("Blue", { x: 9, y: 60, headingDeg: 270 }),
    paths: [
      { ...createLine({ x: 40, y: 30 }, 270, 0), id: "a", controlPoints: [{ x: 20, y: 30 }] },
      { ...createLine({ x: 60, y: 90 }, 0, 0), id: "b", heading: { type: "tangential", reverse: true } },
      { ...createLine({ x: 80, y: 90 }, 0, 0), id: "c", heading: { type: "piecewise", segments: [
        { startProgress: 0, endProgress: 0.5, type: "constant", degrees: 30 },
        { startProgress: 0.5, endProgress: 1, type: "facingPoint", point: { x: 100, y: 120 } },
      ] } },
    ],
  };

  it("reflects poses, points and headings across x = 72", () => {
    const mirrored = mirrorProgram(program);
    expect(mirrored.start).toEqual({ x: 135, y: 60, headingDeg: 270 });
    const [a, b, c] = mirrored.paths as AtomicPath[];
    expect(a.end).toEqual({ x: 104, y: 30 });
    expect(a.controlPoints).toEqual([{ x: 124, y: 30 }]);
    expect(a.heading).toEqual({ type: "linear", startDeg: 270, endDeg: 180 });
    expect(b.heading).toEqual({ type: "tangential", reverse: true });
    expect(c.heading).toEqual({ type: "piecewise", segments: [
      { startProgress: 0, endProgress: 0.5, type: "constant", degrees: 150 },
      { startProgress: 0.5, endProgress: 1, type: "facingPoint", point: { x: 44, y: 120 } },
    ] });
    expect(mirrorAngle(90)).toBe(90);
    expect(mirrorAngle(0)).toBe(180);
  });

  it("returns the original when mirrored twice, and the mirrored routine takes as long", () => {
    expect(mirrorProgram(mirrorProgram(program))).toEqual(program);
    const project = parseProject(structuredClone(sample));
    const auto = project.programs[0] as AutonomousProgram;
    expect(estimateRoutine(mirrorProgram(auto), project).durationMs).toBeCloseTo(estimateRoutine(auto, project).durationMs, 6);
  });
});

describe("path edits", () => {
  const start = () => createAutonomous("Edit", { x: 10, y: 10, headingDeg: 90 });

  it("adds a path that keeps the robot's heading and drives it last", () => {
    const first = addPath(start(), { x: 10, y: 50 });
    const path = first.program.paths[0] as AtomicPath;
    expect(path.heading).toEqual({ type: "linear", startDeg: 90, endDeg: 90 });
    expect(first.program.routine).toEqual([expect.objectContaining({ kind: "path", pathId: first.pathId })]);
    const second = addPath(first.program, { x: 40, y: 50 });
    expect(second.program.paths).toHaveLength(2);
    expect(endPose(second.program)).toEqual({ point: { x: 40, y: 50 }, headingDeg: 90 });
  });

  it("removes a deleted path's steps, including those inside groups", () => {
    let program = addPath(start(), { x: 10, y: 50 }).program;
    const pathId = program.paths[0].id;
    program = { ...program, routine: [...program.routine, { id: "group", kind: "together", steps: [{ id: "inner", kind: "path", pathId }, { id: "wait", kind: "wait", ms: 100 }] }] };
    const after = deletePath(program, pathId);
    expect(after.paths).toEqual([]);
    expect(after.routine).toEqual([{ id: "group", kind: "together", steps: [{ id: "wait", kind: "wait", ms: 100 }] }]);
  });

  it("adds and removes curve handles, moves points, and reorders paths", () => {
    let program = addPath(start(), { x: 10, y: 50 }).program;
    program = addPath(program, { x: 50, y: 50 }).program;
    const [first, second] = program.paths;
    const curved = insertControlPoint(program, second.id);
    const handle = (curved.paths[1] as AtomicPath).controlPoints[0];
    expect(handle.x).toBeCloseTo(30, 6);
    expect(handle.y).not.toBe(50);
    expect((removeControlPoint(curved, second.id, 0).paths[1] as AtomicPath).controlPoints).toEqual([]);
    expect(movePoint(program, { kind: "start" }, { x: 20, y: 20 }).start).toEqual({ x: 20, y: 20, headingDeg: 90 });
    expect((movePoint(program, { kind: "end", pathId: first.id }, { x: 12, y: 60 }).paths[0] as AtomicPath).end).toEqual({ x: 12, y: 60 });
    expect(movePath(program, second.id, -1).paths.map((path) => path.id)).toEqual([second.id, first.id]);
    expect(movePath(program, second.id, 1)).toBe(program);
  });

  it("snaps to the grid and keeps points on the field", () => {
    expect(snapPoint({ x: 13.4, y: 147 }, 6)).toEqual({ x: 12, y: 144 });
    expect(snapPoint({ x: -3, y: 50.26 }, 0)).toEqual({ x: 0, y: 50.3 });
  });

  it("keeps working on a project's programs", () => {
    expect(createProject("x").programs).toEqual([]);
  });
});
