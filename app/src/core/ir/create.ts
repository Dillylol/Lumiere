import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type AtomicPath,
  type AutonomousProgram,
  type Device,
  type DeviceKind,
  type MechanismState,
  type Point,
  type Project,
  type StartPose,
  type Subsystem,
  type TeleOpProgram,
} from "./types";

/** A short random identifier that is unique within a project. */
export function newId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${random}`;
}

const PATH_COLORS = ["#2f80ed", "#27ae60", "#eb5757", "#f2994a", "#9b51e0", "#00a3a3", "#d6336c", "#8a6d3b"];

export function pathColor(index: number): string {
  return PATH_COLORS[index % PATH_COLORS.length];
}

export const DEFAULT_ROBOT = {
  widthInches: 18,
  lengthInches: 18,
  maxVelocity: 50,
  maxAcceleration: 60,
} as const;

export function createProject(name: string, now = new Date()): Project {
  const timestamp = now.toISOString();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: newId("project"),
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    robot: { ...DEFAULT_ROBOT },
    subsystems: [],
    programs: [],
  };
}

export function createAutonomous(name: string, start: StartPose = { x: 9, y: 72, headingDeg: 0 }): AutonomousProgram {
  return {
    id: newId("auto"),
    kind: "autonomous",
    name,
    group: "",
    preselectTeleOp: null,
    start,
    paths: [],
    routine: [],
  };
}

export function createTeleOp(name: string): TeleOpProgram {
  return {
    id: newId("teleop"),
    kind: "teleop",
    name,
    group: "",
    drive: { fieldCentric: true, slowModeButton: "right_bumper", slowModeScale: 0.4, resetHeadingButton: "back" },
    start: { x: 72, y: 72, headingDeg: 90 },
    bindings: [],
  };
}

/** A straight line to `end`, turning evenly from `startDeg` to `endDeg`. */
export function createLine(end: Point, startDeg: number, endDeg: number, index = 0, name = ""): AtomicPath {
  return {
    id: newId("path"),
    name,
    color: pathColor(index),
    kind: "atomic",
    end: { ...end },
    controlPoints: [],
    heading: { type: "linear", startDeg, endDeg },
  };
}

export function createSubsystem(name: string): Subsystem {
  return { id: newId("mech"), name, devices: [], states: [], initialStateId: null };
}

export function createDevice(name: string, kind: DeviceKind): Device {
  return { id: newId("device"), name, kind, reversed: false };
}

export function createState(name: string): MechanismState {
  return { id: newId("state"), name, outputs: {} };
}

/** Returns a copy with a new project id, name, and timestamps. Ids inside a project only need to be unique within it. */
export function duplicateProject(project: Project, name = `${project.name} copy`, now = new Date()): Project {
  const copy: Project = structuredClone(project);
  copy.id = newId("project");
  copy.name = name;
  copy.createdAt = now.toISOString();
  copy.updatedAt = copy.createdAt;
  return copy;
}
