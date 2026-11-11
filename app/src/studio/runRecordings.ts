/**
 * The last simulated run of each program, recorded in Simulate, so Robot mode can play it as the ghost a
 * real run is compared against. Each program keeps one recording, which counts only while the plan it ran
 * (the program, its mechanisms and the robot) is unchanged.
 */
import { checksum, physicalRobot, type AutonomousProgram, type DeviceReport, type Pose, type Project } from "../core";
import type { RunSample } from "./pathing/useRunSession";

export interface RecordedSample {
  /** Time since START, in milliseconds. */
  t: number;
  x: number;
  y: number;
  /** Radians. */
  heading: number;
  /** The program's mechanism devices only. */
  devices?: Record<string, DeviceReport>;
}

export interface SimulatedRun {
  /** The plan the run followed; see {@link planFingerprint}. */
  fingerprint: string;
  opMode: string;
  /** When it was recorded, as an ISO date. */
  recordedAt: string;
  /** The routine's own time, as the OpMode reported it. */
  routineMs: number;
  samples: RecordedSample[];
}

const CHANGED = "lumiere:simulated-runs";
const key = (projectId: string, programId: string) => `lumiere-simulated-run:${projectId}:${programId}`;

/** What a simulated run depends on: the program's start, paths and routine, the mechanisms, and how the robot drives. */
export function planFingerprint(project: Project, program: AutonomousProgram): string {
  return checksum(JSON.stringify({ start: program.start, paths: program.paths, routine: program.routine, subsystems: project.subsystems, robot: physicalRobot(project.robot) }));
}

/**
 * Turns a finished run's samples into a recording: up to a second past the routine's end, keeping only
 * the program's mechanism devices so the recording stays small.
 */
export function recordRun(project: Project, program: AutonomousProgram, samples: RunSample[], routineMs: number, opMode = program.name): SimulatedRun {
  const devices = new Set(project.subsystems.flatMap((subsystem) => subsystem.devices.map((device) => device.name.trim())));
  const kept = samples.filter((item) => item.t <= routineMs + 1000).map((item): RecordedSample => {
    const own = item.devices ? Object.fromEntries(Object.entries(item.devices).filter(([name]) => devices.has(name))) : {};
    return { t: item.t, x: item.x, y: item.y, heading: item.heading, ...(Object.keys(own).length ? { devices: own } : {}) };
  });
  return { fingerprint: planFingerprint(project, program), opMode, recordedAt: new Date().toISOString(), routineMs, samples: kept };
}

function isRun(value: unknown): value is SimulatedRun {
  const run = value as SimulatedRun | null;
  return !!run && typeof run.fingerprint === "string" && typeof run.opMode === "string" && typeof run.recordedAt === "string"
    && Number.isFinite(run.routineMs) && Array.isArray(run.samples)
    && run.samples.every((item) => [item?.t, item?.x, item?.y, item?.heading].every(Number.isFinite));
}

export function loadSimulatedRun(projectId: string, programId: string): SimulatedRun | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(projectId, programId)) ?? "null");
    return isRun(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps a program's latest simulated run. Returns false when storage refused it, such as when full. */
export function saveSimulatedRun(projectId: string, programId: string, run: SimulatedRun): boolean {
  try {
    localStorage.setItem(key(projectId, programId), JSON.stringify(run));
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(CHANGED));
  return true;
}

export function subscribeSimulatedRuns(change: () => void) {
  window.addEventListener(CHANGED, change);
  return () => window.removeEventListener(CHANGED, change);
}

/** The index of the last sample at or before `t`, or -1 before the first. */
function before(run: SimulatedRun, t: number): number {
  let low = 0;
  let high = run.samples.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (run.samples[middle].t <= t) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  return found;
}

/** The recorded pose at a time, between samples by the shorter turn; the first or last pose outside them. */
export function recordedPoseAt(run: SimulatedRun, t: number): Pose | undefined {
  const samples = run.samples;
  if (!samples.length) return undefined;
  const index = before(run, t);
  if (index < 0) return { x: samples[0].x, y: samples[0].y, heading: samples[0].heading };
  const a = samples[index];
  const b = samples[index + 1];
  if (!b || b.t === a.t) return { x: a.x, y: a.y, heading: a.heading };
  const f = (t - a.t) / (b.t - a.t);
  const turn = Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading));
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, heading: a.heading + turn * f };
}

/** The recorded device outputs at a time: the latest sample at or before it. */
export function recordedDevicesAt(run: SimulatedRun, t: number): Record<string, DeviceReport> {
  const index = before(run, t);
  for (let i = Math.max(index, 0); i >= 0; i--) {
    const devices = run.samples[i].devices;
    if (devices) return devices;
  }
  return {};
}
