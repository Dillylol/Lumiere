import { describe, expect, it } from "vitest";
import { isVersion1Project, migrateVersion1 } from "./migrate";
import { parseProject } from "./schema";
import type { AutonomousProgram } from "./types";
import { validateProject } from "./validate";

const version1 = {
  schemaVersion: 1,
  id: "project-old",
  name: "Old Robot",
  createdAt: "2026-01-01T00:00:00.000Z",
  programs: [
    {
      id: "program-1",
      name: "Main Auto",
      kind: "autonomous",
      ir: {
        version: 1,
        actions: [
          { kind: "path", enabled: true, source: "path.linear(24, 72, 0, 90)", args: { mode: "linear", values: "24, 72, 0, 90" } },
          { kind: "servo", enabled: true, source: "servo.set(\"claw\", 0.5)", args: { device: "claw", position: 0.5 } },
          { kind: "wait", enabled: true, source: "wait(250)", args: { duration: 250 } },
          { kind: "drive", enabled: true, source: "drive.forward(0.4, 900)", args: { direction: "forward", power: 0.4, duration: 900 } },
          { kind: "servo", enabled: true, source: "servo.set(\"claw\", 0.5)", args: { device: "claw", position: 0.5 } },
          { kind: "motor", enabled: false, source: "motor.set(\"arm\", 1)", args: { device: "arm", power: 1 } },
          { kind: "stop", enabled: true, source: "stop()", args: {} },
        ],
      },
    },
    { id: "program-2", name: "Main Auto", kind: "teleop", ir: { version: 1, actions: [{ kind: "stop" }] } },
  ],
};

describe("version 1 migration", () => {
  it("recognizes version 1 projects", () => {
    expect(isVersion1Project(version1)).toBe(true);
    expect(isVersion1Project({ format: "ftc-robot-project", version: 2 })).toBe(false);
    expect(() => migrateVersion1({})).toThrow();
  });

  it("carries over paths, waits, and servo commands and lists what was dropped", () => {
    const { project, warnings } = migrateVersion1(version1, new Date("2026-09-13T00:00:00Z"));
    expect(() => parseProject(project)).not.toThrow();
    expect(project.name).toBe("Old Robot");
    expect(project.createdAt).toBe("2026-01-01T00:00:00.000Z");
    const auto = project.programs[0] as AutonomousProgram;
    expect(auto.paths[0]).toMatchObject({ end: { x: 24, y: 72 }, heading: { type: "linear", startDeg: 0, endDeg: 90 } });
    expect(auto.routine.map((step) => step.kind)).toEqual(["path", "state", "wait", "state"]);
    expect(project.subsystems).toHaveLength(1);
    expect(project.subsystems[0].states).toHaveLength(1);
    expect(project.programs[1]).toMatchObject({ kind: "teleop", name: "Main Auto 2" });
    expect(warnings).toHaveLength(3);
    expect(warnings.some((warning) => warning.includes("drives by time"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("disabled"))).toBe(true);
    expect(validateProject(project).filter((item) => item.severity === "error")).toEqual([]);
  });
});
