import { normalizeAngle, toRadians } from "../geometry/curves";
import { resolveProgramPaths, type Pose, type ResolvedPath } from "../geometry/paths";
import type { AutonomousProgram, Project, RobotProfile, Step } from "../ir/types";

/**
 * A kinematic preview of an autonomous routine: where the robot would be over time if it followed
 * each path perfectly with a trapezoidal speed profile. It does not model the follower, traction, or
 * mechanisms, and it is labeled as a preview wherever it is shown. The desktop simulator runs the real
 * code.
 */
export interface PreviewTimeline {
  durationMs: number;
  entries: TimelineEntry[];
  /** Why the preview is incomplete, or null. */
  error: string | null;
  poseAt(ms: number): Pose;
  /** Ids of steps running at a time. */
  activeStepIds(ms: number): string[];
  /** The state id each mechanism is in at a time, keyed by subsystem id. */
  mechanismStates(ms: number): Record<string, string>;
}

export interface TimelineEntry {
  stepId: string;
  kind: Step["kind"];
  startMs: number;
  endMs: number;
}

/** Estimated time for a mechanism state that drives a motor to an encoder target. */
export const TARGET_STATE_ESTIMATE_MS = 500;

/** Time to travel `distance` from rest to rest with a speed and acceleration limit. */
export function travelTimeMs(distance: number, robot: Pick<RobotProfile, "maxVelocity" | "maxAcceleration">): number {
  if (distance <= 0) return 0;
  const { maxVelocity: v, maxAcceleration: a } = robot;
  const rampDistance = (v * v) / a;
  const seconds = distance < rampDistance ? 2 * Math.sqrt(distance / a) : distance / v + v / a;
  return seconds * 1000;
}

/** Distance covered after `ms` on the same profile. */
export function distanceAt(ms: number, distance: number, robot: Pick<RobotProfile, "maxVelocity" | "maxAcceleration">): number {
  const total = travelTimeMs(distance, robot) / 1000;
  const t = Math.max(0, Math.min(total, ms / 1000));
  if (total === 0) return distance;
  const { maxVelocity: v, maxAcceleration: a } = robot;
  const rampDistance = (v * v) / a;
  if (distance < rampDistance) {
    const half = total / 2;
    if (t <= half) return 0.5 * a * t * t;
    const remaining = total - t;
    return distance - 0.5 * a * remaining * remaining;
  }
  const rampTime = v / a;
  if (t <= rampTime) return 0.5 * a * t * t;
  if (t >= total - rampTime) {
    const remaining = total - t;
    return distance - 0.5 * a * remaining * remaining;
  }
  return 0.5 * a * rampTime * rampTime + v * (t - rampTime);
}

interface PathRun {
  entry: TimelineEntry;
  path: ResolvedPath;
}

export function buildTimeline(program: AutonomousProgram, project: Pick<Project, "robot" | "subsystems">): PreviewTimeline {
  const { paths, error } = resolveProgramPaths(program);
  const byId = new Map(paths.map((path) => [path.doc.id, path]));
  const entries: TimelineEntry[] = [];
  const runs: PathRun[] = [];
  const stateChanges: { at: number; subsystemId: string; stateId: string }[] = [];

  const hasTarget = (subsystemId: string, stateId: string) => {
    const state = project.subsystems.find((item) => item.id === subsystemId)?.states.find((item) => item.id === stateId);
    return state ? Object.values(state.outputs).some((output) => output.kind === "target") : false;
  };

  /** Schedules a step starting at `start` and returns its duration. */
  const schedule = (step: Step, start: number): number => {
    let duration = 0;
    switch (step.kind) {
      case "path": {
        const path = byId.get(step.pathId);
        duration = path ? travelTimeMs(path.curve.length, project.robot) : 0;
        const entry = { stepId: step.id, kind: step.kind, startMs: start, endMs: start + duration };
        entries.push(entry);
        if (path) runs.push({ entry, path });
        return duration;
      }
      case "wait":
        duration = step.ms;
        break;
      case "state":
        duration = hasTarget(step.subsystemId, step.stateId) ? TARGET_STATE_ESTIMATE_MS : 0;
        stateChanges.push({ at: start, subsystemId: step.subsystemId, stateId: step.stateId });
        break;
      case "together":
      case "race": {
        const durations = step.steps.map((child) => schedule(child, start));
        duration = !durations.length ? 0 : step.kind === "together" ? Math.max(...durations) : Math.min(...durations);
        break;
      }
    }
    entries.push({ stepId: step.id, kind: step.kind, startMs: start, endMs: start + duration });
    return duration;
  };

  let clock = 0;
  for (const step of program.routine) clock += schedule(step, clock);
  entries.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  runs.sort((a, b) => a.entry.startMs - b.entry.startMs);
  stateChanges.sort((a, b) => a.at - b.at);

  const startPose: Pose = { x: program.start.x, y: program.start.y, heading: normalizeAngle(toRadians(program.start.headingDeg)) };

  return {
    durationMs: clock,
    entries,
    error,
    poseAt(ms) {
      let pose = startPose;
      for (const run of runs) {
        if (ms < run.entry.startMs) break;
        const length = run.path.curve.length;
        const travelled = distanceAt(ms - run.entry.startMs, length, project.robot);
        const t = run.path.curve.parameter(length > 0 ? travelled / length : 1);
        pose = run.path.poseAt(Math.max(0, Math.min(1, t)));
      }
      return pose;
    },
    activeStepIds(ms) {
      return entries.filter((entry) => ms >= entry.startMs && (ms < entry.endMs || (entry.startMs === entry.endMs && ms === entry.startMs))).map((entry) => entry.stepId);
    },
    mechanismStates(ms) {
      const states: Record<string, string> = {};
      for (const subsystem of project.subsystems) {
        if (subsystem.initialStateId) states[subsystem.id] = subsystem.initialStateId;
      }
      for (const change of stateChanges) {
        if (change.at > ms) break;
        states[change.subsystemId] = change.stateId;
      }
      return states;
    },
  };
}
