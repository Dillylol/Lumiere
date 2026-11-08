import { describe, expect, it } from "vitest";
import sample from "../../../../fixtures/projects/sample-robot.json";
import { createAutonomous, createLine, createProject } from "../ir/create";
import { parseProject } from "../ir/schema";
import type { AtomicPath, AutonomousProgram } from "../ir/types";
import { estimateRoutine } from "../motion/estimate";
import { resolvePath } from "../geometry/paths";
import { addPath, addPenPath, deletePath, endPose, insertControlPoint, movePath, movePoint, removeControlPoint, setWaitAfter, snapPoint, waitAfter } from "./edit";
import { fitStroke } from "./pen";
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

  it("reflects poses, points and headings across x = 70.75, the middle of the floor", () => {
    const mirrored = mirrorProgram(program);
    expect(mirrored.start).toEqual({ x: 132.5, y: 60, headingDeg: 270 });
    const [a, b, c] = mirrored.paths as AtomicPath[];
    expect(a.end).toEqual({ x: 101.5, y: 30 });
    expect(a.controlPoints).toEqual([{ x: 121.5, y: 30 }]);
    expect(a.heading).toEqual({ type: "linear", startDeg: 270, endDeg: 180 });
    expect(b.heading).toEqual({ type: "tangential", reverse: true });
    expect(c.heading).toEqual({ type: "piecewise", segments: [
      { startProgress: 0, endProgress: 0.5, type: "constant", degrees: 150 },
      { startProgress: 0.5, endProgress: 1, type: "facingPoint", point: { x: 41.5, y: 120 } },
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

  it("snaps to grid lines spaced from the tile seams and keeps points on the floor", () => {
    // Tile seams sit 1.25 in outside the floor, so a 6-inch grid has lines at 4.75, 10.75, 16.75 …
    expect(snapPoint({ x: 13.4, y: 147 }, 6)).toEqual({ x: 10.75, y: 141.5 });
    expect(snapPoint({ x: 22.6, y: 46.8 }, 24)).toEqual({ x: 22.75, y: 46.75 });
    expect(snapPoint({ x: -3, y: 50.26 }, 0)).toEqual({ x: 0, y: 50.3 });
  });

  it("sets the wait after a path as the routine's own wait step", () => {
    let program = addPath(start(), { x: 10, y: 50 }).program;
    const pathId = program.paths[0].id;
    expect(waitAfter(program, pathId)).toBe(0);
    program = setWaitAfter(program, pathId, 500);
    expect(program.routine.map((step) => step.kind)).toEqual(["path", "wait"]);
    expect(waitAfter(program, pathId)).toBe(500);
    expect(waitAfter(setWaitAfter(program, pathId, 750), pathId)).toBe(750);
    expect(setWaitAfter(program, pathId, 0).routine.map((step) => step.kind)).toEqual(["path"]);
  });

  it("keeps working on a project's programs", () => {
    expect(createProject("x").programs).toEqual([]);
  });
});

describe("pen strokes", () => {
  it("fits a stroke into one path that passes through its sampled points", () => {
    const fitted = fitStroke([{ x: 10, y: 10 }, { x: 30, y: 40 }, { x: 50, y: 10 }])!;
    expect(fitted.start).toEqual({ x: 10, y: 10 });
    expect(fitted.end).toEqual({ x: 50, y: 10 });
    const curve = resolvePath({ ...createLine(fitted.end, 0, 0), controlPoints: fitted.controlPoints }, fitted.start).curve;
    expect(curve.get(0.5).x).toBeCloseTo(30, 1);
    expect(curve.get(0.5).y).toBeCloseTo(40, 1);
    expect(fitStroke([{ x: 10, y: 10 }, { x: 10.1, y: 10 }])).toBeNull();
  });

  it("keeps at most twelve points and starts from an anchor when continuing a path", () => {
    const stroke = Array.from({ length: 200 }, (_, i) => ({ x: 10 + i * 0.5, y: 20 + Math.sin(i / 20) * 10 }));
    const fitted = fitStroke(stroke, { x: 5, y: 5 })!;
    expect(fitted.start).toEqual({ x: 5, y: 5 });
    expect(fitted.controlPoints.length).toBeLessThanOrEqual(10);
  });

  it("adds a drawn path that faces along the stroke, setting the start for the first one", () => {
    const first = addPenPath(createAutonomous("Pen", { x: 9, y: 9, headingDeg: 0 }), [{ x: 20, y: 20 }, { x: 40, y: 30 }, { x: 60, y: 20 }])!;
    expect(first.program.start).toMatchObject({ x: 20, y: 20 });
    expect((first.program.paths[0] as AtomicPath).heading).toEqual({ type: "tangential", reverse: false });
    const second = addPenPath(first.program, [{ x: 80, y: 80 }, { x: 100, y: 90 }])!;
    expect(second.program.start).toEqual(first.program.start);
    expect(second.program.routine).toHaveLength(2);
  });
});
