import { createAutonomous, createDevice, createProject, createState, createSubsystem, createTeleOp, newId, pathColor } from "./create";
import type { AtomicPath, AutonomousProgram, Project, Subsystem } from "./types";

/**
 * Converts a version 1 project (the earlier text-command format) into version 2.
 *
 * Paths, waits, and servo and motor commands carry over. Timed drive and turn commands have no
 * equivalent in path-based programs and are dropped; every dropped command is listed in the warnings
 * so nothing disappears silently. The original file should be kept as a backup.
 */
export interface Migration {
  project: Project;
  warnings: string[];
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

export function isVersion1Project(value: unknown): boolean {
  return isObject(value) && value.schemaVersion === 1 && Array.isArray(value.programs);
}

export function migrateVersion1(value: unknown, now = new Date()): Migration {
  if (!isVersion1Project(value)) throw new Error("This is not a version 1 project.");
  const source = value as Json;
  const warnings: string[] = [];
  const project = createProject(typeof source.name === "string" && source.name.trim() ? source.name : "Imported project", now);
  if (typeof source.createdAt === "string") project.createdAt = source.createdAt;

  const subsystems = new Map<string, Subsystem>();
  const deviceSubsystem = (deviceName: string, kind: "motor" | "servo") => {
    const key = `${kind}:${deviceName}`;
    let subsystem = subsystems.get(key);
    if (!subsystem) {
      subsystem = createSubsystem(deviceName);
      subsystem.devices.push(createDevice(deviceName, kind));
      subsystems.set(key, subsystem);
    }
    return subsystem;
  };
  const stateFor = (subsystem: Subsystem, kind: "motor" | "servo", value: number) => {
    const label = kind === "servo" ? `Position ${value}` : `Power ${value}`;
    let state = subsystem.states.find((item) => item.name === label);
    if (!state) {
      state = createState(label);
      state.outputs[subsystem.devices[0].id] = kind === "servo"
        ? { kind: "position", value: Math.max(0, Math.min(1, value)) }
        : { kind: "power", value: Math.max(-1, Math.min(1, value)) };
      subsystem.states.push(state);
    }
    return state;
  };

  const names = new Set<string>();
  const uniqueName = (name: string) => {
    let candidate = name;
    let counter = 2;
    while (names.has(candidate.toLowerCase())) candidate = `${name} ${counter++}`;
    names.add(candidate.toLowerCase());
    return candidate;
  };

  for (const programValue of source.programs as unknown[]) {
    if (!isObject(programValue)) continue;
    const programName = uniqueName(typeof programValue.name === "string" && programValue.name.trim() ? programValue.name : "Program");
    const actions = isObject(programValue.ir) && Array.isArray(programValue.ir.actions) ? programValue.ir.actions.filter(isObject) : [];
    if (programValue.kind === "teleop") {
      project.programs.push(createTeleOp(programName));
      if (actions.length) warnings.push(`"${programName}": the TeleOp's commands were not carried over. Add gamepad buttons in the new TeleOp editor.`);
      continue;
    }
    const auto: AutonomousProgram = createAutonomous(programName);
    let heading = 0;
    let first = true;
    for (const action of actions) {
      const args = isObject(action.args) ? action.args : {};
      const label = typeof action.source === "string" ? action.source : String(action.kind);
      if (action.enabled === false) {
        warnings.push(`"${programName}": the disabled command "${label}" was not carried over.`);
        continue;
      }
      switch (action.kind) {
        case "wait":
          auto.routine.push({ id: newId("step"), kind: "wait", ms: Math.max(0, Number(args.duration) || 0) });
          break;
        case "servo":
        case "motor": {
          const kind = action.kind;
          const deviceName = typeof args.device === "string" && args.device ? args.device : kind;
          const subsystem = deviceSubsystem(deviceName, kind);
          const state = stateFor(subsystem, kind, Number(kind === "servo" ? args.position : args.power) || 0);
          auto.routine.push({ id: newId("step"), kind: "state", subsystemId: subsystem.id, stateId: state.id });
          break;
        }
        case "path": {
          const numbers = String(args.values ?? "").split(/[,@]/).map((part) => Number(part.trim())).filter((part) => Number.isFinite(part));
          if (numbers.length < 2) {
            warnings.push(`"${programName}": the path command "${label}" could not be read.`);
            break;
          }
          const [x, y] = numbers;
          let path: AtomicPath;
          const index = auto.paths.length;
          const base = { id: newId("path"), name: "", color: pathColor(index), kind: "atomic" as const, end: { x, y }, controlPoints: [] };
          if (args.mode === "tangent") {
            path = { ...base, heading: { type: "tangential", reverse: numbers[3] === 1 } };
          } else if (args.mode === "constant") {
            heading = numbers[2] ?? heading;
            path = { ...base, heading: { type: "constant", degrees: heading } };
          } else {
            const start = numbers.length >= 4 ? numbers[2] : heading;
            const end = numbers.length >= 4 ? numbers[3] : numbers[2] ?? heading;
            heading = end;
            path = { ...base, heading: { type: "linear", startDeg: start, endDeg: end } };
          }
          if (first) {
            auto.start = { x: 72, y: 72, headingDeg: path.heading.type === "linear" ? path.heading.startDeg : heading };
            first = false;
          }
          auto.paths.push(path);
          auto.routine.push({ id: newId("step"), kind: "path", pathId: path.id });
          break;
        }
        case "stop":
          break;
        default:
          warnings.push(`"${programName}": "${label}" drives by time, which path-based programs do not use. Draw a path instead.`);
      }
    }
    project.programs.push(auto);
  }
  project.subsystems = [...subsystems.values()];
  project.updatedAt = now.toISOString();
  return { project, warnings };
}

