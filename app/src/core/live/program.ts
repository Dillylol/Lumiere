/**
 * Lumière Live: an autonomous program as the app sends it to the robot, so the robot can run it
 * without the team rebuilding and installing the robot code. This version of the robot library only
 * checks the program against the robot's hardware (a dry run); nothing moves.
 *
 * The program carries the same numbers the generated Java uses: angles in degrees, and every path's
 * start, control and end poses as the generated OpMode declares them. So the robot can build exactly
 * the paths a deployed OpMode would. docs/protocol.md describes the format; the robot library's
 * `LiveProgram` reads it.
 */
import { javaNumber } from "../codegen/java/names";
import { checksum } from "../codegen/java/ownership";
import { toDegrees } from "../geometry/curves";
import { resolvePath } from "../geometry/paths";
import { hardwareEntry } from "../ir/hardware";
import type { AutonomousProgram, DeviceKind, Heading, MechanismState, Output, Point, Project, Step } from "../ir/types";

/** The program format this app sends. The robot library refuses formats newer than it reads. */
export const LIVE_FORMAT = 1;
/** The Driver Station name of the generated Lumière Live OpMode. */
export const LIVE_OPMODE_NAME = "Lumière Live";
/** The highest power Lumière Live gives a mechanism unless the team chooses otherwise. */
export const LIVE_DEFAULT_POWER_CAP = 0.6;

export interface LivePose {
  x: number;
  y: number;
  headingDeg: number;
}

/** A line (no control points) or Bezier curve, with the poses the generated Java declares for it. */
export interface LiveSegment {
  start: LivePose;
  controls: Point[];
  end: LivePose;
  /** The segment's own heading rule, or null when its compound path sets one for all segments. */
  heading: Heading | null;
}

export interface LivePath {
  id: string;
  name: string;
  kind: "atomic" | "compound";
  segments: LiveSegment[];
  /** A compound path's heading rule across all segments, or null when each segment has its own. */
  heading: Heading | null;
}

/** A mechanism's device with its settings from the robot's hardware list. */
export interface LiveDevice {
  id: string;
  name: string;
  kind: DeviceKind;
  reversed: boolean;
  travel?: { minTicks: number; maxTicks: number };
}

export interface LiveMechanism {
  id: string;
  name: string;
  devices: LiveDevice[];
  states: MechanismState[];
  initialState: string | null;
}

export type LiveStep =
  | { kind: "path"; path: string }
  | { kind: "wait"; ms: number }
  | { kind: "state"; mechanism: string; state: string }
  | { kind: "together" | "race"; steps: LiveStep[] };

export interface LiveProgram {
  format: typeof LIVE_FORMAT;
  name: string;
  /** Changes whenever anything the robot would do changes. */
  revision: string;
  start: LivePose;
  mechanisms: LiveMechanism[];
  paths: LivePath[];
  routine: LiveStep[];
}

/** What the robot reports about Lumière Live: the `live` message in docs/protocol.md. */
export interface LiveReport {
  opMode: string;
  /** `waiting` for a program, `checking` one, `accepted`, `rejected`, or `closed` once the OpMode stops. */
  state: "waiting" | "checking" | "accepted" | "rejected" | "closed";
  started: boolean;
  /** Whether a computer is paired with this run of Lumière Live. */
  paired: boolean;
  /** True when the robot's Lumière Live only checks programs and moves nothing (an older robot library). */
  dryRun: boolean;
  powerCap: number;
  /** How long the robot waits to hear from the paired computer before it stops a run, in milliseconds. */
  silenceMs: number;
  /**
   * The run after START: `running`, `finished` (the routine is done and the robot holds its last
   * pose), `stopped` with the reason, or `not run` with the reason. Absent before START.
   */
  run?: { phase: "running" | "finished" | "stopped" | "not run"; reason: string | null; elapsedMs?: number };
  program: { name: string; revision: string; steps: number; paths: number; mechanisms: number } | null;
  problems: string[];
  notes: string[];
}

/**
 * The program Lumière Live receives for an autonomous: its paths with the poses the generated Java
 * declares, the mechanisms the routine uses (or that have a starting state, as deployed OpModes
 * initialize them), and the routine without empty groups.
 */
export function buildLiveProgram(project: Project, program: AutonomousProgram): LiveProgram {
  const start = pose(program.start.x, program.start.y, program.start.headingDeg);
  const paths: LivePath[] = [];
  let cursor: Point = program.start;
  let from = start;
  for (const doc of program.paths) {
    const resolved = resolvePath(doc, cursor);
    if (doc.kind === "compound") {
      let segmentCursor = cursor;
      const segments = doc.segments.map((segment): LiveSegment => {
        const end = pose(segment.end.x, segment.end.y, toDegrees(resolvePath(segment, segmentCursor).poseAt(1).heading));
        const built = { start: from, controls: segment.controlPoints.map(point), end, heading: doc.heading ? null : heading(segment.heading) };
        from = end;
        segmentCursor = segment.end;
        return built;
      });
      paths.push({ id: doc.id, name: doc.name, kind: "compound", segments, heading: doc.heading ? heading(doc.heading) : null });
    } else {
      const end = pose(doc.end.x, doc.end.y, toDegrees(resolved.poseAt(1).heading));
      paths.push({ id: doc.id, name: doc.name, kind: "atomic", segments: [{ start: from, controls: doc.controlPoints.map(point), end, heading: heading(doc.heading) }], heading: null });
      from = end;
    }
    cursor = resolved.end;
  }

  const used = new Set<string>();
  const collect = (steps: Step[]) => steps.forEach((step) => {
    if (step.kind === "state") used.add(step.subsystemId);
    if (step.kind === "together" || step.kind === "race") collect(step.steps);
  });
  collect(program.routine);
  const mechanisms = project.subsystems
    .filter((subsystem) => used.has(subsystem.id) || subsystem.initialStateId)
    .map((subsystem): LiveMechanism => ({
      id: subsystem.id, name: subsystem.name, initialState: subsystem.initialStateId,
      devices: subsystem.devices.map((device) => {
        const settings = hardwareEntry(project.robot, device.name);
        return { ...device, reversed: settings?.reversed ?? false, ...(settings?.travel ? { travel: settings.travel } : {}) };
      }),
      states: subsystem.states.map((state) => ({ ...state, outputs: Object.fromEntries(Object.entries(state.outputs).map(([id, out]) => [id, output(out)])) })),
    }));

  const body = { format: LIVE_FORMAT as typeof LIVE_FORMAT, name: program.name.trim(), start, mechanisms, paths, routine: liveSteps(program.routine) };
  return { ...body, revision: checksum(JSON.stringify(body)) };
}

/** The routine's steps, leaving out groups with nothing in them, as the generated Java does. */
function liveSteps(steps: Step[]): LiveStep[] {
  const result: LiveStep[] = [];
  for (const step of steps) {
    if (step.kind === "path") result.push({ kind: "path", path: step.pathId });
    else if (step.kind === "wait") result.push({ kind: "wait", ms: java(step.ms) });
    else if (step.kind === "state") {
      if (step.duration) throw new Error(`${LIVE_OPMODE_NAME} can't run timed actions yet.`);
      result.push({ kind: "state", mechanism: step.subsystemId, state: step.stateId });
    }
    else if (step.kind === "device") throw new Error(`${LIVE_OPMODE_NAME} can't run Motor, Servo and continuous servo actions yet.`);
    else {
      const children = liveSteps(step.steps);
      if (children.length) result.push({ kind: step.kind, steps: children });
    }
  }
  return result;
}

/**
 * A number exactly as the generated Java has it: the generator writes 6 decimal places, so Lumière Live
 * gets the same double a deployed OpMode parses from its source.
 */
const java = (value: number) => Number(javaNumber(value));
const pose = (x: number, y: number, headingDeg: number): LivePose => ({ x: java(x), y: java(y), headingDeg: java(headingDeg) });
const point = (value: Point): Point => ({ x: java(value.x), y: java(value.y) });

function heading(rule: Heading): Heading {
  switch (rule.type) {
    case "linear": return { type: "linear", startDeg: java(rule.startDeg), endDeg: java(rule.endDeg) };
    case "constant": return { type: "constant", degrees: java(rule.degrees) };
    case "tangential": return { type: "tangential", reverse: rule.reverse };
    case "piecewise": return {
      type: "piecewise",
      segments: rule.segments.map((part) => {
        const range = { startProgress: java(part.startProgress), endProgress: java(part.endProgress) };
        switch (part.type) {
          case "linear": return { ...range, type: "linear", startDeg: java(part.startDeg), endDeg: java(part.endDeg) };
          case "constant": return { ...range, type: "constant", degrees: java(part.degrees) };
          case "tangential": return { ...range, type: "tangential", reverse: part.reverse };
          case "facingPoint": return { ...range, type: "facingPoint", point: point(part.point) };
        }
      }),
    };
  }
}

/** An output as the generated Java sets it: rounded values, and encoder targets in whole ticks. */
function output(value: Output): Output {
  switch (value.kind) {
    case "power": return { kind: "power", value: java(value.value) };
    case "position": return { kind: "position", value: java(value.value) };
    case "target": return { kind: "target", ticks: Math.round(value.ticks), power: java(value.power) };
  }
}

const RUN_PHASES = ["running", "finished", "stopped", "not run"];

function readRun(value: unknown): Pick<LiveReport, "run"> {
  if (!value || typeof value !== "object") return {};
  const run = value as Record<string, unknown>;
  if (typeof run.phase !== "string" || !RUN_PHASES.includes(run.phase)) return {};
  return { run: {
    phase: run.phase as NonNullable<LiveReport["run"]>["phase"],
    reason: typeof run.reason === "string" ? run.reason.slice(0, 400) : null,
    ...(typeof run.elapsedMs === "number" && run.elapsedMs >= 0 ? { elapsedMs: run.elapsedMs } : {}),
  } };
}

/** Reads a `live` message, keeping only well-formed fields. */
export function readLiveReport(value: unknown): LiveReport | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  const states = ["waiting", "checking", "accepted", "rejected", "closed"];
  if (typeof message.state !== "string" || !states.includes(message.state)) return null;
  const texts = (list: unknown) => (Array.isArray(list) ? list.filter((item): item is string => typeof item === "string").slice(0, 50).map((item) => item.slice(0, 400)) : []);
  const summary = message.program && typeof message.program === "object" ? message.program as Record<string, unknown> : null;
  const count = (key: string) => (summary && typeof summary[key] === "number" ? summary[key] as number : 0);
  return {
    opMode: typeof message.opMode === "string" ? message.opMode.slice(0, 80) : LIVE_OPMODE_NAME,
    state: message.state as LiveReport["state"],
    started: message.started === true,
    paired: message.paired === true,
    dryRun: message.dryRun !== false,
    powerCap: typeof message.powerCap === "number" ? message.powerCap : LIVE_DEFAULT_POWER_CAP,
    silenceMs: typeof message.silenceMs === "number" && message.silenceMs > 0 ? message.silenceMs : 1000,
    ...readRun(message.run),
    program: summary ? {
      name: typeof summary.name === "string" ? summary.name.slice(0, 120) : "",
      revision: typeof summary.revision === "string" ? summary.revision.slice(0, 64) : "",
      steps: count("steps"), paths: count("paths"), mechanisms: count("mechanisms"),
    } : null,
    problems: texts(message.problems),
    notes: texts(message.notes),
  };
}
