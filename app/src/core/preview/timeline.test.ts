import { describe, expect, it } from "vitest";
import sample from "../../../../fixtures/projects/sample-robot.json";
import { parseProject } from "../ir/schema";
import type { AutonomousProgram } from "../ir/types";
import { buildTimeline, distanceAt, TARGET_STATE_ESTIMATE_MS, travelTimeMs } from "./timeline";

const robot = { maxVelocity: 50, maxAcceleration: 60 };

describe("trapezoidal profile", () => {
  it("uses a triangle for short moves and a trapezoid for long ones", () => {
    // Short: 2 * sqrt(d / a).
    expect(travelTimeMs(10, robot)).toBeCloseTo(2000 * Math.sqrt(10 / 60), 6);
    // Long: d / v + v / a.
    expect(travelTimeMs(100, robot)).toBeCloseTo((100 / 50 + 50 / 60) * 1000, 6);
    expect(travelTimeMs(0, robot)).toBe(0);
  });

  it("covers the whole distance, monotonically", () => {
    for (const distance of [5, 41.666, 120]) {
      const total = travelTimeMs(distance, robot);
      let previous = 0;
      for (let ms = 0; ms <= total; ms += total / 50) {
        const covered = distanceAt(ms, distance, robot);
        expect(covered).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = covered;
      }
      expect(distanceAt(total, distance, robot)).toBeCloseTo(distance, 9);
    }
  });
});

describe("routine preview", () => {
  const project = parseProject(structuredClone(sample));
  const auto = project.programs[0] as AutonomousProgram;
  const timeline = buildTimeline(auto, project);

  it("schedules groups, waits, and mechanism estimates", () => {
    const entry = (id: string) => timeline.entries.find((item) => item.stepId === id)!;
    expect(timeline.error).toBeNull();
    expect(entry("step_1").endMs).toBe(Math.max(entry("step_1a").endMs, TARGET_STATE_ESTIMATE_MS));
    expect(entry("step_2").startMs).toBe(entry("step_1").endMs);
    expect(entry("step_3").endMs - entry("step_3").startMs).toBe(300);
    // A race ends with its shortest child: the claw closes instantly.
    expect(entry("step_6").endMs).toBe(entry("step_6").startMs);
    expect(timeline.durationMs).toBe(entry("step_9").endMs);
  });

  it("moves the robot from the start pose to the last path's end", () => {
    const start = timeline.poseAt(0);
    expect(start).toMatchObject({ x: 9, y: 111 });
    expect(start.heading).toBeCloseTo((270 * Math.PI) / 180, 9);
    const end = timeline.poseAt(timeline.durationMs + 1000);
    expect(end.x).toBeCloseTo(60, 6);
    expect(end.y).toBeCloseTo(96, 6);
  });

  it("tracks mechanism states and active steps", () => {
    expect(timeline.mechanismStates(0)).toEqual({ mech_claw: "state_claw_closed", mech_intake: "state_intake_stop", mech_lift: "state_lift_high" });
    const later = timeline.entries.find((item) => item.stepId === "step_8")!.startMs;
    expect(timeline.mechanismStates(later)).toMatchObject({ mech_intake: "state_intake_stop", mech_lift: "state_lift_down", mech_claw: "state_claw_closed" });
    expect(timeline.activeStepIds(1)).toEqual(expect.arrayContaining(["step_1", "step_1a", "step_1b"]));
  });
});
