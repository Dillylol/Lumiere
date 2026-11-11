import { describe, expect, it } from "vitest";
import sample from "../../../../fixtures/projects/sample-robot.json";
import { resolvePath } from "../geometry/paths";
import { createAutonomous, createLine, createProject, DEFAULT_ROBOT } from "../ir/create";
import { parseProject } from "../ir/schema";
import type { AtomicPath, AutonomousProgram, Heading, Step } from "../ir/types";
import { directional, estimateRoutine, profilePath, SETTLE_MS, TARGET_STATE_ESTIMATE_MS } from "./estimate";

const robot = { ...DEFAULT_ROBOT };
const line = (x: number, y: number, heading: Heading): AtomicPath => ({ ...createLine({ x, y }, 0, 0), heading });
const forward: Heading = { type: "constant", degrees: 0 };

/** Rest-to-rest time on a straight line with separate acceleration and braking, in seconds. */
function closedForm(length: number, top: number, accel: number, brake: number) {
  const rampDistance = (top * top) / (2 * accel) + (top * top) / (2 * brake);
  if (length >= rampDistance) return top / accel + top / brake + (length - rampDistance) / top;
  const peak = Math.sqrt(length / (1 / (2 * accel) + 1 / (2 * brake)));
  return peak / accel + peak / brake;
}

describe("profilePath", () => {
  it("matches the closed form on a straight forward line, short and long", () => {
    for (const length of [48, 120]) {
      const path = resolvePath(line(10 + length, 10, forward), { x: 10, y: 10 });
      const profile = profilePath(path, robot, 0);
      const expected = closedForm(length, robot.maxForwardVelocity, robot.acceleration, robot.forwardDeceleration) * 1000;
      expect(profile.moveMs).toBeCloseTo(expected, -1);
      expect(profile.durationMs).toBeCloseTo(profile.moveMs + SETTLE_MS, 6);
      expect(profile.turnMs).toBe(0);
    }
  });

  it("drives sideways at the strafe speed and brakes at the strafe deceleration", () => {
    const sideways = resolvePath(line(10, 130, forward), { x: 10, y: 10 });
    const profile = profilePath(sideways, robot, 0);
    const expected = closedForm(120, robot.maxStrafeVelocity, robot.acceleration, robot.strafeDeceleration) * 1000;
    expect(profile.moveMs).toBeCloseTo(expected, -1);
    expect(profile.topSpeed).toBeCloseTo(robot.maxStrafeVelocity, 6);
    expect(directional(60, 50, Math.PI / 4)).toBeGreaterThan(50);
    expect(directional(60, 50, Math.PI / 4)).toBeLessThan(60);
  });

  it("slows down for a tight curve but not a broad one", () => {
    const tangent: Heading = { type: "tangential", reverse: false };
    const timeOn = (controlPoints: { x: number; y: number }[], end: { x: number; y: number }) => {
      const curved = resolvePath({ ...line(end.x, end.y, tangent), controlPoints }, { x: 10, y: 10 });
      const straight = resolvePath(line(10 + curved.curve.length, 10, tangent), { x: 10, y: 10 });
      return { curved: profilePath(curved, robot, Math.PI / 2), straight: profilePath(straight, robot, 0) };
    };
    // A hairpin about 10 inches across: √(a·r) is well under the top speed.
    const hairpin = timeOn([{ x: 10, y: 70 }, { x: 30, y: 70 }], { x: 30, y: 10 });
    expect(hairpin.curved.moveMs).toBeGreaterThan(hairpin.straight.moveMs * 1.05);
    // A broad U-turn about 60 inches across allows full speed, like a straight line.
    const broad = timeOn([{ x: 10, y: 90 }, { x: 110, y: 90 }], { x: 110, y: 10 });
    expect(broad.curved.moveMs).toBeCloseTo(broad.straight.moveMs, -1);
  });

  it("turns in place first when the path starts facing another way", () => {
    const path = resolvePath(line(58, 10, forward), { x: 10, y: 10 });
    expect(profilePath(path, robot, Math.PI / 2).turnMs).toBeCloseTo((90 / robot.turnRateDeg) * 1000, 6);
    expect(profilePath(path, robot, 0.001).turnMs).toBe(0);
  });

  it("caps speed so the heading never turns faster than the robot can", () => {
    // 180° over 24 inches needs 7.5°/in, so at 180°/s the robot can go at most 24 in/s.
    const spinning = profilePath(resolvePath(line(34, 10, { type: "linear", startDeg: 0, endDeg: 180 }), { x: 10, y: 10 }), robot, 0);
    const steady = profilePath(resolvePath(line(34, 10, forward), { x: 10, y: 10 }), robot, 0);
    expect(spinning.topSpeed).toBeLessThanOrEqual(24.5);
    expect(steady.topSpeed).toBeGreaterThan(35);
    expect(spinning.moveMs).toBeGreaterThan(steady.moveMs);
  });
});

describe("estimateRoutine", () => {
  it("stops a path where it is when its race ends", () => {
    const program: AutonomousProgram = { ...createAutonomous("Race", { x: 10, y: 10, headingDeg: 0 }) };
    const path = line(130, 10, forward);
    program.paths = [path];
    const steps: Step[] = [{ id: "race", kind: "race", steps: [{ id: "drive", kind: "path", pathId: path.id }, { id: "wait", kind: "wait", ms: 300 }] }];
    program.routine = steps;
    const estimate = estimateRoutine(program, createProject("Race"));
    expect(estimate.durationMs).toBe(300);
    const atEnd = estimate.poseAt(300);
    expect(atEnd.x).toBeGreaterThan(10);
    expect(atEnd.x).toBeLessThan(20);
    expect(estimate.poseAt(5000)).toEqual(atEnd);
  });

  it("gives timed actions their whole time, then the state after, which a race brings forward", () => {
    const project = createProject("Timed");
    project.subsystems.push({ id: "roller", name: "Roller", initialStateId: "stop", devices: [{ id: "d", name: "roller", kind: "crservo" }], states: [
      { id: "spin", name: "Spin", outputs: { d: { kind: "power", value: 1 } } },
      { id: "stop", name: "Stop", outputs: { d: { kind: "power", value: 0 } } },
    ] });
    const program = createAutonomous("Timed");
    program.routine = [
      { id: "a", kind: "state", subsystemId: "roller", stateId: "spin", duration: { ms: 2000, thenStateId: "stop" } },
      { id: "b", kind: "device", device: "intake", deviceKind: "motor", output: { kind: "power", value: 1 }, duration: { ms: 500 } },
      { id: "c", kind: "race", steps: [
        { id: "c1", kind: "state", subsystemId: "roller", stateId: "spin", duration: { ms: 3000, thenStateId: "stop" } },
        { id: "c2", kind: "wait", ms: 1000 },
      ] },
    ];
    const estimate = estimateRoutine(program, project);
    expect(estimate.durationMs).toBe(2000 + 500 + 1000);
    expect(estimate.entries.find((entry) => entry.stepId === "b")).toMatchObject({ startMs: 2000, endMs: 2500 });
    expect(estimate.mechanismStates(1999).roller).toBe("spin");
    expect(estimate.mechanismStates(2000).roller).toBe("stop");
    // In the race, the wait ends first, so the roller stops then, not after its own 3 seconds.
    expect(estimate.mechanismStates(2600).roller).toBe("spin");
    expect(estimate.mechanismStates(3500).roller).toBe("stop");
  });

  it("follows the robot's heading from one path into the next", () => {
    const program = createAutonomous("Turns", { x: 10, y: 10, headingDeg: 90 });
    const first = line(58, 10, forward);
    program.paths = [first];
    program.routine = [{ id: "a", kind: "path", pathId: first.id }];
    const estimate = estimateRoutine(program, createProject("Turns"));
    const profile = estimate.profiles.get(first.id)!;
    expect(profile.turnMs).toBeCloseTo(500, 6);
    expect(estimate.poseAt(profile.turnMs / 2).heading).toBeCloseTo(Math.PI / 4, 6);
    expect(estimate.poseAt(profile.turnMs / 2).x).toBeCloseTo(10, 6);
  });
});

describe("routine estimate on the sample project", () => {
  const project = parseProject(structuredClone(sample));
  const auto = project.programs[0] as AutonomousProgram;
  const estimate = estimateRoutine(auto, project);

  it("schedules groups, waits, and mechanism estimates", () => {
    const entry = (id: string) => estimate.entries.find((item) => item.stepId === id)!;
    expect(estimate.error).toBeNull();
    expect(entry("step_1").endMs).toBe(Math.max(entry("step_1a").endMs, TARGET_STATE_ESTIMATE_MS));
    expect(entry("step_2").startMs).toBe(entry("step_1").endMs);
    expect(entry("step_3").endMs - entry("step_3").startMs).toBe(300);
    // A race ends with its shortest child: the claw closes instantly.
    expect(entry("step_6").endMs).toBe(entry("step_6").startMs);
    expect(estimate.durationMs).toBe(entry("step_9").endMs);
  });

  it("moves the robot from the start pose to the last path's end", () => {
    const start = estimate.poseAt(0);
    expect(start).toMatchObject({ x: 9, y: 111 });
    expect(start.heading).toBeCloseTo((270 * Math.PI) / 180, 9);
    const end = estimate.poseAt(estimate.durationMs + 1000);
    expect(end.x).toBeCloseTo(60, 6);
    expect(end.y).toBeCloseTo(96, 6);
  });

  it("tracks mechanism states and active steps", () => {
    expect(estimate.mechanismStates(0)).toEqual({ mech_claw: "state_claw_closed", mech_intake: "state_intake_stop", mech_lift: "state_lift_high" });
    const later = estimate.entries.find((item) => item.stepId === "step_8")!.startMs;
    expect(estimate.mechanismStates(later)).toMatchObject({ mech_intake: "state_intake_stop", mech_lift: "state_lift_down", mech_claw: "state_claw_closed" });
    expect(estimate.activeStepIds(1)).toEqual(expect.arrayContaining(["step_1", "step_1a", "step_1b"]));
  });
});
