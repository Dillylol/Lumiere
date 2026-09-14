import { describe, expect, it } from "vitest";
import sample from "../../../../fixtures/projects/sample-robot.json";
import { resolveProgramPaths } from "../geometry/paths";
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
    const exported = exportVisualizer(auto, new Date("2026-09-13T00:00:00Z"));
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

  it("warns about newer files", () => {
    const newer = JSON.stringify({ ...JSON.parse(current), version: "2.0.0" });
    expect(importVisualizer(newer).warnings[0]).toContain("newer Visualizer");
  });
});
