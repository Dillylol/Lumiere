import { describe, expect, it } from "vitest";
import sample from "../../../../fixtures/projects/sample-robot.json";
import { resolvePath, resolveProgramPaths } from "../geometry/paths";
import { parseProject } from "../ir/schema";
import type { AutonomousProgram } from "../ir/types";
import { exportVisualizer, importVisualizer } from "./visualizer";

const legacy = JSON.stringify({
  startPoint: { x: 56, y: 8, heading: "linear", startDeg: 90, endDeg: 180 },
  lines: [
    { endPoint: { x: 56, y: 36, heading: "constant", degrees: 90 }, controlPoints: [], color: "#123456" },
    {
      id: "second",
      name: "Around",
      endPoint: { x: 20, y: 60, heading: "tangential", reverse: true },
      controlPoints: [{ x: 56, y: 60 }],
      color: "#654321",
      waitBefore: { name: "settle", durationMs: 250 },
    },
  ],
  shapes: [{ id: "s", vertices: [], color: "#f00", fillColor: "#f00" }],
});

const current = JSON.stringify({
  version: "1.5.0",
  startPoint: { x: 10, y: 10, headingDeg: 45 },
  lines: [
    {
      kind: "compound",
      id: "group",
      name: "Group",
      color: "#111111",
      heading: { type: "linear", startDeg: 45, endDeg: 0 },
      segments: [
        { kind: "atomic", id: "g1", color: "#111111", endPoint: { x: 40, y: 10 }, controlPoints: [], heading: { type: "tangential", reverse: false } },
        { kind: "atomic", id: "g2", color: "#111111", endPoint: { x: 70, y: 40 }, controlPoints: [{ x: 70, y: 10 }], heading: { type: "tangential", reverse: false } },
      ],
    },
    {
      kind: "atomic",
      id: "last",
      color: "#222222",
      endPoint: { x: 100, y: 40 },
      controlPoints: [],
      heading: {
        type: "piecewise",
        piecewiseHeading: {
          segments: [
            { startProgress: 0, endProgress: 0.5, interpolationType: "tangential", reversed: false },
            { startProgress: 0.5, endProgress: 1, interpolationType: "linear", continueFromPrevious: true, parameters: { endDeg: 90 } },
          ],
        },
      },
    },
  ],
  sequence: [
    { kind: "path", lineId: "g1" },
    { kind: "path", lineId: "g2" },
    { kind: "wait", id: "w", name: "Wait", durationMs: 500 },
    { kind: "path", lineId: "last" },
  ],
});

describe("Visualizer .pp files", () => {
  it("imports the legacy format with point headings and waits", () => {
    const imported = importVisualizer(legacy);
    expect(imported.start).toEqual({ x: 56, y: 8, headingDeg: 90 });
    expect(imported.paths).toHaveLength(2);
    expect(imported.paths[0]).toMatchObject({ kind: "atomic", end: { x: 56, y: 36 }, heading: { type: "constant", degrees: 90 }, color: "#123456" });
    expect(imported.paths[1]).toMatchObject({ id: "second", name: "Around", heading: { type: "tangential", reverse: true } });
    expect(imported.routine.map((step) => step.kind)).toEqual(["path", "wait", "path"]);
    expect(imported.warnings).toEqual(["Obstacle shapes were not imported."]);
  });

  it("imports 1.5.0 compound paths, sequences, and continued headings", () => {
    const imported = importVisualizer(current);
    expect(imported.paths.map((path) => path.kind)).toEqual(["compound", "atomic"]);
    expect(imported.routine.map((step) => (step.kind === "path" ? step.pathId : step.kind))).toEqual(["group", "wait", "last"]);
    const last = imported.paths[1];
    if (last.kind !== "atomic" || last.heading.type !== "piecewise") throw new Error("expected a piecewise heading");
    const continued = last.heading.segments[1];
    // The first half faces along the line from (70, 40) to (100, 40), so it continues from 0 degrees.
    expect(continued).toMatchObject({ type: "linear", endDeg: 90 });
    if (continued.type === "linear") expect(continued.startDeg).toBeCloseTo(0, 9);
  });

  it("rejects files that are not Visualizer projects", () => {
    expect(() => importVisualizer("not json")).toThrow(/not valid JSON/);
    expect(() => importVisualizer("{}")).toThrow(/does not contain/);
  });

  it("round-trips the sample autonomous paths", () => {
    const auto = parseProject(structuredClone(sample)).programs[0] as AutonomousProgram;
    const exported = exportVisualizer(auto, { now: new Date("2026-09-13T00:00:00Z") });
    expect(exported.warnings).toHaveLength(2);
    const imported = importVisualizer(exported.text);
    expect(imported.start).toEqual(auto.start);
    expect(imported.paths).toEqual(auto.paths);
    const before = resolveProgramPaths(auto).paths.map((path) => path.poseAt(0.37));
    const after = resolveProgramPaths({ ...auto, paths: imported.paths }).paths.map((path) => path.poseAt(0.37));
    expect(after).toEqual(before);
    expect(imported.routine.filter((step) => step.kind === "path").map((step) => step.kind === "path" && step.pathId))
      .toEqual(["path_score", "path_pickup", "path_return", "path_park"]);
  });


  it("imports 2.0.0 through paths as equivalent control points and reports robot settings", () => {
    const source = JSON.stringify({
      version: "2.0.0",
      startPoint: { x: 10, y: 10, headingDeg: 0 },
      robot: { rLength: 19, rWidth: 16, forwardVelocity: 42 },
      fieldPoints: [{ x: 40, y: 30 }],
      lines: [{
        id: "curve",
        endPoint: { x: 70, y: 20 },
        throughPoints: [{ x: 30, y: 30 }, { x: 50, y: 45 }],
        controlPoints: [{ x: 90, y: 80 }],
      }],
    });
    const robot = { lengthInches: 18, widthInches: 18 };
    const imported = importVisualizer(source, { robot });
    const curve = resolvePath(imported.paths[0], imported.start).curve;
    expect(curve.get(1 / 3).x).toBeCloseTo(30, 8);
    expect(curve.get(1 / 3).y).toBeCloseTo(30, 8);
    expect(curve.get(2 / 3).x).toBeCloseTo(50, 8);
    expect(curve.get(2 / 3).y).toBeCloseTo(45, 8);
    expect(imported.warnings).toHaveLength(3);
    expect(imported.warnings.join("\n")).toContain("19 × 16 in");
    expect(imported.warnings.join("\n")).toContain("18 × 18 in");
    expect(imported.warnings.join("\n")).toContain("Control points saved alongside");
    const exported = exportVisualizer(imported, { robot });
    expect(JSON.parse(exported.text)).toMatchObject({ version: "2.0.0", robot: { rLength: 18, rWidth: 18 } });
    expect(importVisualizer(exported.text, { robot }).warnings).toEqual([]);
  });

  it("reads the Visualizer's legacy length and width settings in the right order", () => {
    const source = JSON.stringify({ ...JSON.parse(legacy), settings: { rWidth: 20, rHeight: 15 } });
    expect(importVisualizer(source).warnings.join("\n")).toContain("20 × 15 in");
  });

  it("continues a group heading from its reversed tangent", () => {
    const source = JSON.parse(current);
    source.lines[0].heading = {
      type: "piecewise",
      piecewiseHeading: { segments: [
        { startProgress: 0, endProgress: 0.1, interpolationType: "tangential", reversed: true },
        { startProgress: 0.1, endProgress: 1, interpolationType: "constant", continueFromPrevious: true },
      ] },
    };
    const group = importVisualizer(JSON.stringify(source)).paths[0];
    expect(group).toMatchObject({
      kind: "compound",
      heading: { type: "piecewise", segments: [
        { type: "tangential", reverse: true },
        { type: "constant", degrees: 180 },
      ] },
    });
  });

  it("preserves repeated paths and complete compound passes in the sequence", () => {
    const source = JSON.parse(current);
    source.sequence = ["g1", "g2", "g1", "g2", "last", "last"].map(lineId => ({ kind: "path", lineId }));
    expect(importVisualizer(JSON.stringify(source)).routine.map(step => step.kind === "path" && step.pathId))
      .toEqual(["group", "group", "last", "last"]);
  });

  it("reports nested groups instead of importing them as an empty segment", () => {
    const source = JSON.parse(current);
    source.lines[0].segments = [{ kind: "compound", segments: source.lines[0].segments }];
    expect(() => importVisualizer(JSON.stringify(source))).toThrow(/Ungroup nested paths/);
  });

  it("warns about newer files", () => {
    const newer = JSON.stringify({ ...JSON.parse(current), version: "2.1.0" });
    expect(importVisualizer(newer).warnings[0]).toContain("newer Visualizer");
  });
});
