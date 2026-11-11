import { afterEach, describe, expect, it } from "vitest";
import sample from "../../../fixtures/projects/sample-robot.json";
import { parseProject, type AutonomousProgram } from "../core";
import { loadSimulatedRun, planFingerprint, recordedDevicesAt, recordedPoseAt, recordRun, saveSimulatedRun } from "./runRecordings";
import type { RunSample } from "./pathing/useRunSession";

const project = parseProject(structuredClone(sample));
const program = project.programs[0] as AutonomousProgram;
const samples: RunSample[] = [0, 100, 200, 300, 1300].map((t, i) => ({
  t, x: 10 + i, y: 20, heading: i === 1 ? Math.PI - 0.1 : i === 2 ? -Math.PI + 0.1 : 0, data: {},
  devices: { claw: { type: "servo", position: i < 2 ? 0.25 : 0.8 }, lf: { type: "motor", power: 1, position: 10 * i } },
}));

afterEach(() => localStorage.clear());

describe("simulated runs", () => {
  it("records a run up to a second past its routine, keeping only mechanism devices", () => {
    const run = recordRun(project, program, samples, 250);
    expect(run.fingerprint).toBe(planFingerprint(project, program));
    expect(run.opMode).toBe("Blue Basket");
    expect(run.samples.map((item) => item.t)).toEqual([0, 100, 200, 300]);
    expect(Object.keys(run.samples[0].devices ?? {})).toEqual(["claw"]);
  });

  it("changes its fingerprint when the plan changes, not when the robot is only scanned", () => {
    const moved = structuredClone(program);
    moved.start.x += 1;
    expect(planFingerprint(project, moved)).not.toBe(planFingerprint(project, program));
    const scanned = { ...project, robot: { ...project.robot, scan: { devices: [{ name: "claw", type: "servo" }], scannedAt: "2026-11-10" } } };
    expect(planFingerprint(scanned, program)).toBe(planFingerprint(project, program));
  });

  it("plays back poses between samples by the shorter turn, and the devices at a time", () => {
    const run = recordRun(project, program, samples, 1000);
    expect(recordedPoseAt(run, 50)).toEqual({ x: 10.5, y: 20, heading: (Math.PI - 0.1) / 2 });
    // From just under +180° to just over -180° is a short turn through 180°, not a spin the other way.
    const across = recordedPoseAt(run, 150)!;
    expect(Math.abs(Math.cos(across.heading) + 1)).toBeLessThan(1e-9);
    expect(recordedPoseAt(run, -5)).toEqual({ x: 10, y: 20, heading: 0 });
    expect(recordedPoseAt(run, 99_999)).toEqual({ x: 14, y: 20, heading: 0 });
    expect(recordedDevicesAt(run, 150).claw.position).toBe(0.25);
    expect(recordedDevicesAt(run, 250).claw.position).toBe(0.8);
  });

  it("keeps one run per program in storage", () => {
    expect(loadSimulatedRun("project", program.id)).toBeUndefined();
    const run = recordRun(project, program, samples, 1000);
    expect(saveSimulatedRun("project", program.id, run)).toBe(true);
    expect(loadSimulatedRun("project", program.id)).toEqual(run);
    localStorage.setItem(`lumiere-simulated-run:project:${program.id}`, "{\"broken\":true}");
    expect(loadSimulatedRun("project", program.id)).toBeUndefined();
  });
});
