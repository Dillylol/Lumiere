import { angleError, normalizeAngle, toRadians } from "../geometry/curves";
import { resolveProgramPaths, type Pose, type ResolvedPath } from "../geometry/paths";
import type { AutonomousProgram, Project, RobotProfile, Step } from "../ir/types";

/**
 * A physics-bound estimate of an autonomous routine: how long each step takes and where the robot
 * is along the way, from the robot profile's Pedro speeds and decelerations.
 *
 * Along each path, sampled every half inch, the robot's speed is capped by:
 * - its direction of travel relative to its heading: an ellipse between forward and strafe speed;
 * - curvature: v ≤ √(a·r), taking the robot's acceleration as the grip it has for turning. This is
 *   an assumption; coast deceleration measures rolling friction, far below cornering traction;
 * - the heading change the path asks for: v ≤ turn rate ÷ heading change per inch.
 *
 * It speeds up from rest at `acceleration` and brakes to rest at the coast deceleration for its
 * direction of travel, the way Pedro's Foresight plans braking. A path whose starting heading
 * differs from the robot's is turned in place first, and each path ends with a short settle while
 * Pedro checks its end constraints.
 *
 * It does not model the follower's corrections, wheel slip, battery voltage, or mechanisms beyond
 * the estimates below. The desktop simulator runs the real code.
 */

/** Time a path's end takes to settle within Pedro's end constraints, in milliseconds. */
export const SETTLE_MS = 100;
/** Estimated time for a mechanism state that drives a motor to an encoder target. */
export const TARGET_STATE_ESTIMATE_MS = 500;
const SAMPLE_INCHES = 0.5;
const MAX_SAMPLES = 2000;
/** Heading differences below this at a path's start are corrected while driving, not turned first. */
const TURN_THRESHOLD = toRadians(1);

export type MotionRobot = Pick<RobotProfile,
  "maxForwardVelocity" | "maxStrafeVelocity" | "forwardDeceleration" | "strafeDeceleration" | "acceleration" | "turnRateDeg">;

/** How the robot drives one path, sampled by distance. */
export interface PathProfile {
  /** Inches along the path. */
  distance: number[];
  /** Curve parameter at each sample. */
  parameter: number[];
  /** Speed in inches per second. */
  speed: number[];
  /** Milliseconds since the robot began moving along the path. */
  time: number[];
  /** Turning in place before moving, in milliseconds. */
  turnMs: number;
  moveMs: number;
  /** Turn, move and settle together. */
  durationMs: number;
  topSpeed: number;
}

export interface TimelineEntry {
  stepId: string;
  kind: Step["kind"];
  startMs: number;
  endMs: number;
}

export interface RoutineEstimate {
  durationMs: number;
  entries: TimelineEntry[];
  /** Why the estimate is incomplete, or null. */
  error: string | null;
  poseAt(ms: number): Pose;
  /** Ids of steps running at a time. */
  activeStepIds(ms: number): string[];
  /** The state id each mechanism is in at a time, keyed by subsystem id. */
  mechanismStates(ms: number): Record<string, string>;
  /** Each path's speed profile from its first run, by path id. */
  profiles: Map<string, PathProfile>;
}

/** A speed or deceleration in a direction `phi` radians from the robot's heading: an ellipse between its forward and strafe values. */
export function directional(forward: number, strafe: number, phi: number): number {
  const along = Math.cos(phi) / forward;
  const across = Math.sin(phi) / strafe;
  return 1 / Math.sqrt(along * along + across * across);
}

/** How the robot drives `path`, starting at rest with heading `startHeading` (radians), when known. */
export function profilePath(path: ResolvedPath, robot: MotionRobot, startHeading?: number): PathProfile {
  const length = path.curve.length;
  const count = Math.min(MAX_SAMPLES, Math.max(8, Math.ceil(length / SAMPLE_INCHES)));
  const step = length / count;
  const distance: number[] = [];
  const parameter: number[] = [];
  const poses: Pose[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = Math.max(0, Math.min(1, path.curve.parameter(length > 0 ? (i * step) / length : 1)));
    distance.push(i * step);
    parameter.push(t);
    poses.push(path.poseAt(t));
  }
  const travel = poses.map((_, i) => {
    const before = poses[Math.max(0, i - 1)];
    const after = poses[Math.min(count, i + 1)];
    return Math.atan2(after.y - before.y, after.x - before.x);
  });
  const sideways = (i: number) => angleError(poses[i].heading, travel[i]);
  const turnRate = toRadians(robot.turnRateDeg);

  const cap = poses.map((_, i) => {
    let limit = directional(robot.maxForwardVelocity, robot.maxStrafeVelocity, sideways(i));
    if (i > 0 && i < count) {
      const bend = Math.abs(angleError(travel[i - 1], travel[i + 1])) / (2 * step);
      if (bend > 1e-6) limit = Math.min(limit, Math.sqrt(robot.acceleration / bend));
      const spin = Math.abs(angleError(poses[i - 1].heading, poses[i + 1].heading)) / (2 * step);
      if (spin > 1e-6) limit = Math.min(limit, turnRate / spin);
    }
    return limit;
  });

  const speed = new Array<number>(count + 1).fill(0);
  for (let i = 1; i <= count; i += 1) speed[i] = Math.min(cap[i], Math.sqrt(speed[i - 1] ** 2 + 2 * robot.acceleration * step));
  speed[count] = 0;
  for (let i = count - 1; i >= 0; i -= 1) {
    const brake = directional(robot.forwardDeceleration, robot.strafeDeceleration, sideways(i));
    speed[i] = Math.min(speed[i], Math.sqrt(speed[i + 1] ** 2 + 2 * brake * step));
  }
  speed[0] = 0;

  const time = [0];
  for (let i = 1; i <= count; i += 1) {
    const sum = speed[i - 1] + speed[i];
    time.push(time[i - 1] + (sum > 0 ? ((2 * step) / sum) * 1000 : 0));
  }
  const turn = startHeading === undefined ? 0 : Math.abs(angleError(startHeading, poses[0].heading));
  const turnMs = turn > TURN_THRESHOLD ? (turn / turnRate) * 1000 : 0;
  const moveMs = time[count];
  return { distance, parameter, speed, time, turnMs, moveMs, durationMs: turnMs + moveMs + SETTLE_MS, topSpeed: Math.max(...speed) };
}

/** Where the robot is `ms` after a path's run began. */
function poseInPath(path: ResolvedPath, profile: PathProfile, startHeading: number, ms: number): Pose {
  if (ms < profile.turnMs) {
    const target = path.poseAt(0);
    return { ...target, heading: normalizeAngle(startHeading + angleError(startHeading, target.heading) * (ms / profile.turnMs)) };
  }
  const moving = ms - profile.turnMs;
  const { time, parameter } = profile;
  if (moving >= profile.moveMs) return path.poseAt(1);
  let low = 0;
  let high = time.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (time[middle] <= moving) low = middle;
    else high = middle;
  }
  const span = time[high] - time[low];
  const t = parameter[low] + (span > 0 ? ((moving - time[low]) / span) * (parameter[high] - parameter[low]) : 0);
  return path.poseAt(t);
}

interface PathRun {
  entry: TimelineEntry;
  path: ResolvedPath;
  profile: PathProfile;
  startHeading: number;
  /** When a race ended this run early; the robot stops where it is. */
  cutoffMs: number;
}

export function estimateRoutine(program: AutonomousProgram, project: Pick<Project, "robot" | "subsystems">): RoutineEstimate {
  const { paths, error } = resolveProgramPaths(program);
  const byId = new Map(paths.map((path) => [path.doc.id, path]));
  const entries: TimelineEntry[] = [];
  const runs: PathRun[] = [];
  const profiles = new Map<string, PathProfile>();
  const stateChanges: { at: number; subsystemId: string; stateId: string }[] = [];
  const startPose: Pose = { x: program.start.x, y: program.start.y, heading: normalizeAngle(toRadians(program.start.headingDeg)) };
  let heading = startPose.heading;

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
        if (path) {
          const profile = profilePath(path, project.robot, heading);
          if (!profiles.has(path.doc.id)) profiles.set(path.doc.id, profile);
          duration = profile.durationMs;
          const entry = { stepId: step.id, kind: step.kind, startMs: start, endMs: start + duration };
          runs.push({ entry, path, profile, startHeading: heading, cutoffMs: Infinity });
          entries.push(entry);
          heading = path.poseAt(1).heading;
          return duration;
        }
        break;
      }
      case "wait":
        duration = step.ms;
        break;
      case "state":
        duration = hasTarget(step.subsystemId, step.stateId) ? TARGET_STATE_ESTIMATE_MS : 0;
        stateChanges.push({ at: start, subsystemId: step.subsystemId, stateId: step.stateId });
        break;
      case "device":
        // Like a mechanism state: a power or position is set at once, and an encoder target takes a while.
        duration = step.output.kind === "target" ? TARGET_STATE_ESTIMATE_MS : 0;
        break;
      case "together":
      case "race": {
        const firstRun = runs.length;
        const durations = step.steps.map((child) => schedule(child, start));
        duration = !durations.length ? 0 : step.kind === "together" ? Math.max(...durations) : Math.min(...durations);
        if (step.kind === "race") {
          for (const run of runs.slice(firstRun)) run.cutoffMs = Math.min(run.cutoffMs, start + duration);
        }
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

  return {
    durationMs: clock,
    entries,
    error,
    profiles,
    poseAt(ms) {
      let pose = startPose;
      for (const run of runs) {
        if (ms < run.entry.startMs) break;
        pose = poseInPath(run.path, run.profile, run.startHeading, Math.min(ms, run.cutoffMs) - run.entry.startMs);
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
