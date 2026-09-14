import { resolvePath } from "../geometry/paths";
import {
  FIELD_INCHES,
  type AutonomousProgram,
  type Binding,
  type GamepadButton,
  type PathDoc,
  type Point,
  type Project,
  type Step,
  type Subsystem,
  type TeleOpProgram,
} from "./types";

export type Severity = "error" | "warning" | "info";

export interface DiagnosticLocation {
  programId?: string;
  pathId?: string;
  stepId?: string;
  subsystemId?: string;
  stateId?: string;
  deviceId?: string;
  bindingId?: string;
}

export interface Diagnostic {
  severity: Severity;
  /** Stable identifier for tests and documentation links. */
  code: string;
  message: string;
  location: DiagnosticLocation;
}

/** OpModes that generated projects already contain. */
const RESERVED_OPMODE_NAMES = ["Example Auto", "Example TeleOp"];

/** Longest an autonomous period lasts, in milliseconds. */
export const AUTONOMOUS_PERIOD_MS = 30_000;

/**
 * Checks a project for problems that would stop generated code from compiling or behaving as the
 * student intends. Errors block code generation; warnings and info are advice.
 */
export function validateProject(project: Project): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const add = (severity: Severity, code: string, message: string, location: DiagnosticLocation = {}) =>
    diagnostics.push({ severity, code, message, location });

  if (!project.name.trim()) add("error", "project.name", "Give the project a name.");

  const names = new Map<string, string>();
  for (const program of project.programs) {
    const name = program.name.trim();
    if (!name) {
      add("error", "program.name.empty", "Give this OpMode a name. It is what the Driver Station shows.", { programId: program.id });
      continue;
    }
    const key = name.toLowerCase();
    if (names.has(key)) {
      add("error", "program.name.duplicate", `Two OpModes are named "${name}". Driver Station names must be unique.`, { programId: program.id });
    }
    names.set(key, program.id);
    if (RESERVED_OPMODE_NAMES.some((reserved) => reserved.toLowerCase() === key)) {
      add("warning", "program.name.reserved", `"${name}" is also the name of an example in the robot project. Choose another name.`, { programId: program.id });
    }
  }

  validateSubsystems(project.subsystems, add);

  for (const program of project.programs) {
    if (program.kind === "autonomous") validateAutonomous(program, project, add);
    else validateTeleOp(program, project, add);
  }
  return diagnostics;
}

type Add = (severity: Severity, code: string, message: string, location?: DiagnosticLocation) => void;

function validateSubsystems(subsystems: Subsystem[], add: Add) {
  const subsystemNames = new Set<string>();
  const hardwareOwners = new Map<string, string>();
  for (const subsystem of subsystems) {
    const at = { subsystemId: subsystem.id };
    const name = subsystem.name.trim();
    if (!name) add("error", "subsystem.name.empty", "Give this mechanism a name.", at);
    else if (subsystemNames.has(name.toLowerCase())) add("error", "subsystem.name.duplicate", `Two mechanisms are named "${name}".`, at);
    subsystemNames.add(name.toLowerCase());

    if (!subsystem.devices.length) add("warning", "subsystem.devices.empty", `"${name || "This mechanism"}" has no devices yet.`, at);
    const deviceNames = new Set<string>();
    for (const device of subsystem.devices) {
      const where = { ...at, deviceId: device.id };
      const hardwareName = device.name.trim();
      if (!hardwareName) {
        add("error", "device.name.empty", "Enter the device's name from the Robot Controller configuration.", where);
        continue;
      }
      if (deviceNames.has(hardwareName)) add("error", "device.name.duplicate", `"${hardwareName}" is listed twice in this mechanism.`, where);
      deviceNames.add(hardwareName);
      const owner = hardwareOwners.get(hardwareName);
      if (owner && owner !== subsystem.id) {
        add("error", "device.shared", `"${hardwareName}" belongs to more than one mechanism. Each device can be controlled by only one.`, where);
      }
      hardwareOwners.set(hardwareName, subsystem.id);
    }

    const stateNames = new Set<string>();
    for (const state of subsystem.states) {
      const where = { ...at, stateId: state.id };
      const stateName = state.name.trim();
      if (!stateName) add("error", "state.name.empty", "Give this state a name, such as Open or Raised.", where);
      else if (stateNames.has(stateName.toLowerCase())) add("error", "state.name.duplicate", `Two states are named "${stateName}".`, where);
      stateNames.add(stateName.toLowerCase());
      for (const [deviceId, output] of Object.entries(state.outputs)) {
        const device = subsystem.devices.find((item) => item.id === deviceId);
        if (!device) {
          add("error", "state.output.device", `State "${stateName}" sets a device that is no longer in this mechanism.`, where);
          continue;
        }
        const allowed = device.kind === "servo" ? ["position"] : device.kind === "crservo" ? ["power"] : ["power", "target"];
        if (!allowed.includes(output.kind)) {
          add("error", "state.output.kind", `A ${device.kind === "crservo" ? "continuous rotation servo" : device.kind} cannot be given a ${output.kind}.`, { ...where, deviceId });
        }
      }
    }
    if (subsystem.initialStateId && !subsystem.states.some((state) => state.id === subsystem.initialStateId)) {
      add("error", "subsystem.initialState", "The starting state no longer exists.", at);
    }
  }
}

function insideField(point: Point) {
  return point.x >= 0 && point.x <= FIELD_INCHES && point.y >= 0 && point.y <= FIELD_INCHES;
}

function validateAutonomous(program: AutonomousProgram, project: Project, add: Add) {
  const at = { programId: program.id };
  if (!insideField(program.start)) add("error", "auto.start.field", "The starting pose is outside the field (0 to 144 inches).", at);

  const pathIds = new Set<string>();
  let start: Point = program.start;
  for (const path of program.paths) {
    const where = { ...at, pathId: path.id };
    if (pathIds.has(path.id)) add("error", "path.id.duplicate", "Two paths share an id.", where);
    pathIds.add(path.id);
    for (const end of pathEnds(path)) {
      if (!insideField(end)) add("error", "path.end.field", `A point on "${label(path)}" is outside the field.`, where);
    }
    for (const control of pathControls(path)) {
      if (!insideField(control)) add("warning", "path.control.field", `A control point of "${label(path)}" is outside the field. The curve may leave the field.`, where);
    }
    try {
      start = resolvePath(path, start).end;
    } catch {
      add("error", "path.length.zero", `"${label(path)}" ends where it starts. Move its end point.`, where);
      start = path.kind === "atomic" ? path.end : path.segments[path.segments.length - 1]?.end ?? start;
    }
  }

  const driven: string[] = [];
  const visit = (steps: Step[], group: "together" | "race" | null) => {
    const groupPaths: string[] = [];
    const groupSubsystems = new Map<string, number>();
    for (const step of steps) {
      const where = { ...at, stepId: step.id };
      switch (step.kind) {
        case "path":
          if (!pathIds.has(step.pathId)) add("error", "step.path.missing", "This step drives a path that no longer exists.", where);
          else driven.push(step.pathId);
          groupPaths.push(step.pathId);
          break;
        case "wait":
          if (step.ms > AUTONOMOUS_PERIOD_MS) add("warning", "step.wait.long", "This wait is longer than the 30 second autonomous period.", where);
          break;
        case "state": {
          const subsystem = project.subsystems.find((item) => item.id === step.subsystemId);
          if (!subsystem) add("error", "step.state.subsystem", "This step uses a mechanism that no longer exists.", where);
          else if (!subsystem.states.some((state) => state.id === step.stateId)) add("error", "step.state.missing", `This step uses a state that "${subsystem.name}" no longer has.`, where);
          groupSubsystems.set(step.subsystemId, (groupSubsystems.get(step.subsystemId) ?? 0) + 1);
          break;
        }
        case "together":
        case "race":
          if (!step.steps.length) add("warning", "step.group.empty", "This group has no steps.", where);
          visit(step.steps, step.kind);
          break;
      }
    }
    if (group && groupPaths.length > 1) {
      add("error", "step.group.paths", "Only one path can be driven at a time. Put these paths in order instead of grouping them.", at);
    }
    if (group) {
      for (const [subsystemId, count] of groupSubsystems) {
        if (count > 1) {
          const subsystem = project.subsystems.find((item) => item.id === subsystemId);
          add("warning", "step.group.subsystem", `"${subsystem?.name ?? "A mechanism"}" is set more than once at the same time; only the last setting sticks.`, at);
        }
      }
    }
  };
  visit(program.routine, null);

  const order = program.paths.map((path) => path.id);
  const positions = driven.map((id) => order.indexOf(id)).filter((index) => index >= 0);
  if (positions.some((position, index) => index > 0 && position !== positions[index - 1] + 1)) {
    add("warning", "routine.path.order", "Paths are driven out of order or skipped. Each path starts where the previous one in the list ends, so the robot may jump.", at);
  }
  if (positions.length && positions[0] !== 0) {
    add("warning", "routine.path.first", "The first path driven is not the first path in the list, so it may not start at the starting pose.", at);
  }
  for (const path of program.paths) {
    if (!driven.includes(path.id)) add("info", "path.unused", `"${label(path)}" is never driven in the routine.`, { ...at, pathId: path.id });
  }
  if (program.preselectTeleOp && !project.programs.some((item) => item.kind === "teleop" && item.name === program.preselectTeleOp)) {
    add("info", "auto.preselect", `No TeleOp in this project is named "${program.preselectTeleOp}". It must exist in the robot project.`, at);
  }
}

function validateTeleOp(program: TeleOpProgram, project: Project, add: Add) {
  const at = { programId: program.id };
  if (!insideField(program.start)) add("error", "teleop.start.field", "The starting pose is outside the field (0 to 144 inches).", at);
  const used = new Map<string, Binding>();
  const reserve = (button: GamepadButton | null, purpose: string) => {
    if (button) used.set(`1:${button}`, { id: purpose, gamepad: 1, button, action: { kind: "state", subsystemId: "", stateId: "" } });
  };
  reserve(program.drive.slowModeButton, "slow mode");
  reserve(program.drive.resetHeadingButton, "reset heading");
  if (program.drive.slowModeButton && program.drive.slowModeButton === program.drive.resetHeadingButton) {
    add("error", "teleop.drive.buttons", "Slow mode and heading reset use the same button.", at);
  }
  for (const binding of program.bindings) {
    const where = { ...at, bindingId: binding.id };
    const key = `${binding.gamepad}:${binding.button}`;
    const existing = used.get(key);
    if (existing) {
      const purpose = existing.id === "slow mode" || existing.id === "reset heading" ? existing.id : "another binding";
      add("error", "binding.button.duplicate", `Gamepad ${binding.gamepad} ${buttonLabel(binding.button)} is already used for ${purpose}.`, where);
    }
    used.set(key, binding);
    const subsystem = project.subsystems.find((item) => item.id === binding.action.subsystemId);
    if (!subsystem) {
      add("error", "binding.subsystem", "This button controls a mechanism that no longer exists.", where);
      continue;
    }
    const states = binding.action.kind === "state" ? [binding.action.stateId]
      : binding.action.kind === "toggle" ? [binding.action.firstStateId, binding.action.secondStateId]
        : [binding.action.heldStateId, binding.action.releasedStateId];
    if (states.some((stateId) => !subsystem.states.some((state) => state.id === stateId))) {
      add("error", "binding.state", `This button uses a state that "${subsystem.name}" no longer has.`, where);
    }
    if (states.length === 2 && states[0] === states[1]) {
      add("warning", "binding.state.same", "Both states are the same, so the button will not change anything.", where);
    }
  }
}

export function buttonLabel(button: GamepadButton): string {
  return button.replace(/_/g, " ").replace("dpad", "D-pad");
}

function label(path: PathDoc) {
  return path.name.trim() || "Unnamed path";
}

function pathEnds(path: PathDoc): Point[] {
  return path.kind === "atomic" ? [path.end] : path.segments.map((segment) => segment.end);
}

function pathControls(path: PathDoc): Point[] {
  return path.kind === "atomic" ? path.controlPoints : path.segments.flatMap((segment) => segment.controlPoints);
}

export const hasErrors = (diagnostics: Diagnostic[]) => diagnostics.some((item) => item.severity === "error");
