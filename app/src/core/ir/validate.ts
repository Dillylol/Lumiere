import { resolvePath } from "../geometry/paths";
import { deviceKindLabel, deviceUses, hardwareEntry, limitPower, outputKinds, powerLimitOf, useOutputs, type DeviceUse } from "./hardware";
import { DRIVE_ROLES, ENCODER_ROLES, pedroDevices, pedroMismatches, pedroRoleLabel, pedroRoleType } from "./pedro";
import { LIVE_OPMODE_NAME } from "../live/program";
import {
  DRIVE_MOTOR_POSITIONS,
  FIELD_INCHES,
  type AutonomousProgram,
  type Binding,
  type DeviceKind,
  type GamepadButton,
  type Output,
  type PathDoc,
  type Point,
  type Project,
  type Step,
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
  /** The robot profile on the Robot page. */
  robot?: true;
  /** A device in the Robot page's hardware list, by its configured name. */
  hardware?: string;
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
    if (key === LIVE_OPMODE_NAME.toLowerCase()) {
      add("error", "program.name.live", `"${name}" is the name of ${LIVE_OPMODE_NAME}, the OpMode that runs programs sent from this computer. Choose another name.`, { programId: program.id });
    } else if (RESERVED_OPMODE_NAMES.some((reserved) => reserved.toLowerCase() === key)) {
      add("warning", "program.name.reserved", `"${name}" is also the name of an example in the robot project. Choose another name.`, { programId: program.id });
    }
  }

  validateSubsystems(project, add);
  validateHardware(project, add);
  validateRobot(project, add);

  for (const program of project.programs) {
    if (program.kind === "autonomous") validateAutonomous(program, project, add);
    else validateTeleOp(program, project, add);
  }
  return diagnostics;
}

type Add = (severity: Severity, code: string, message: string, location?: DiagnosticLocation) => void;

/** The largest robot that fits FTC's starting sizing cube, in inches. */
export const SIZING_CUBE_INCHES = 18;

const DRIVE_LABELS = { frontLeft: "front-left", frontRight: "front-right", backLeft: "back-left", backRight: "back-right" } as const;

/**
 * Checks the robot profile against the rules and against the hardware the robot last reported.
 * Hardware checks only run once the robot has been scanned; they compare names exactly, as the
 * FTC SDK's hardware map does.
 */
function validateRobot(project: Project, add: Add) {
  const robot = project.robot;
  const at = { robot: true } as const;
  if (robot.widthInches > SIZING_CUBE_INCHES || robot.lengthInches > SIZING_CUBE_INCHES) {
    add("warning", "robot.size.cube", `The robot is ${robot.lengthInches} × ${robot.widthInches} in. FTC robots must fit an ${SIZING_CUBE_INCHES}-inch sizing cube at the start of a match.`, at);
  }
  if (robot.constants?.tuned === false) {
    add("info", "robot.constants.untuned", "The Pedro constants are not tuned yet (TUNED is false), so speeds and decelerations are estimates. Run the AutoTune tuners and paste the results into Constants.java.", at);
  }
  if (robot.constants?.unreadable.length) {
    add("info", "robot.constants.unreadable", `Lumière could not read ${robot.constants.unreadable.join(", ")} in Constants.java, so the profile keeps its own value.`, at);
  }

  if (!robot.scan) return;
  const pedro = pedroDevices(robot);
  const configured = new Map(robot.scan.devices.map((device) => [device.name, device.type]));
  if (robot.drivetrain) {
    for (const position of DRIVE_MOTOR_POSITIONS) {
      const motor = robot.drivetrain[position];
      const type = configured.get(motor.name);
      if (type === undefined) add("warning", "robot.drive.missing", `The ${DRIVE_LABELS[position]} drive motor "${motor.name}" is not in the robot's configuration.`, at);
      else if (type !== "motor") add("warning", "robot.drive.type", `"${motor.name}" is configured as ${type}, not a motor.`, at);
    }
  }
  for (const owned of pedro) {
    if (DRIVE_ROLES.has(owned.role)) continue;
    const type = configured.get(owned.name);
    const expected = pedroRoleType(owned.role);
    if (type === undefined) add("warning", "robot.localizer.missing", `Pedro Pathing's ${pedroRoleLabel(owned.role)} "${owned.name}" is not in the robot's configuration.`, at);
    else if (expected && type !== expected) add("warning", "robot.localizer.type", `"${owned.name}" is configured as ${type}, but Pedro Pathing uses it as its ${pedroRoleLabel(owned.role)}, which needs ${expected === "motor" ? "a motor port" : expected}.`, at);
  }
  for (const mismatch of pedroMismatches(robot)) {
    add("warning", "robot.pedro.mismatch", `The project's Pedro constants name "${mismatch.constants}" as the ${pedroRoleLabel(mismatch.role)}, but the robot reports "${mismatch.robot}". Install the latest code on the robot, or relink the FTC SDK project to read its constants again.`, at);
  }
}

/** A device kind with its article, such as "a continuous servo". */
const withArticle = (kind: DeviceKind) => `a ${deviceKindLabel(kind)}`;
const useLocation = (use: DeviceUse): DiagnosticLocation => ("step" in use
  ? { programId: use.programId, stepId: use.step.id }
  : { subsystemId: use.subsystem.id, deviceId: use.deviceId });

/**
 * Checks the hardware list and every use of a device: mechanisms' devices and direct actions. A use must
 * agree with the device's entry in the list, and may not drive Pedro Pathing's devices. Once the robot has
 * been scanned, each used device is checked against the robot's configuration too; those are warnings,
 * because the configuration may have changed since the scan.
 */
function validateHardware(project: Project, add: Add) {
  const robot = project.robot;
  const listed = new Set<string>();
  for (const device of robot.hardware ?? []) {
    const at = { robot: true, hardware: device.name } as const;
    if (listed.has(device.name)) add("error", "hardware.duplicate", `"${device.name}" is in the hardware list twice.`, at);
    listed.add(device.name);
    if (device.travel && device.kind !== "motor") add("error", "hardware.travel", `"${device.name}" is ${withArticle(device.kind)}; only motors have a travel range.`, at);
    else if (device.travel && device.travel.minTicks >= device.travel.maxTicks) add("error", "hardware.travel", `"${device.name}"'s travel must go from a lower number of ticks to a higher one.`, at);
    if (device.powerLimit !== undefined && device.kind === "servo") add("error", "hardware.limit", `"${device.name}" is a servo, which is given positions, so it can't have a power limit.`, at);
  }

  // Pedro Pathing drives these devices, so mechanisms and actions must leave them alone.
  const pedro = pedroDevices(robot);
  const configured = robot.scan ? new Map(robot.scan.devices.map((device) => [device.name, device.type])) : undefined;
  for (const [name, uses] of deviceUses(project)) {
    const entry = hardwareEntry(robot, name);
    const kinds = [...new Set(uses.map((use) => use.kind))];
    const roles = pedro.filter((owned) => owned.name === name).map((owned) => owned.role);
    const wheel = roles.find((role) => ENCODER_ROLES.has(role));
    const other = roles.find((role) => !ENCODER_ROLES.has(role) && !DRIVE_ROLES.has(role));
    for (const use of uses) {
      const where = useLocation(use);
      const user = "step" in use ? "this action" : use.subsystem.name || "its mechanism";
      const subject = "step" in use ? `"${name}"` : `"${name}" in ${use.subsystem.name || "a mechanism"}`;
      if (roles.some((role) => DRIVE_ROLES.has(role))) {
        add("error", "robot.device.drive", `${subject} is a drive motor. Pedro Pathing drives it, so ${"step" in use ? "an action" : "a mechanism"} can't.`, where);
        continue;
      }
      if (entry && entry.kind !== use.kind) {
        add("error", "device.kind", `${subject} is used as ${withArticle(use.kind)}, but the hardware list has it as ${withArticle(entry.kind)}.`, where);
      } else if (!entry && kinds.length > 1) {
        add("error", "device.kind", `"${name}" is used as ${kinds.map(withArticle).join(" and as ")}. Use it as one kind of device everywhere.`, where);
      }
      if (wheel && use.kind === "motor" && useOutputs(use).some((output) => output.kind === "target")) {
        add("error", "robot.device.odometry", `${subject} has Pedro Pathing's ${pedroRoleLabel(wheel)} on its encoder port, so an encoder target would follow the dead wheel, and resetting the encoder would break localization. Give this motor power instead, or move the dead wheel to another port.`, where);
      }
      if (other) add("warning", "robot.device.pedro", `${subject} is Pedro Pathing's ${pedroRoleLabel(other)}.`, where);
      if (!configured) continue;
      const type = configured.get(name);
      if (type === undefined) add("warning", "robot.device.missing", `${subject} is not in the robot's configuration.`, where);
      else if (type !== use.kind) add("warning", "robot.device.type", `"${name}" is configured as ${type}, but ${user} uses it as ${withArticle(use.kind)}.`, where);
    }
  }
}

/** A number as a note shows it: up to two decimal places. */
const shown = (value: number) => String(Math.round(value * 100) / 100);

/**
 * A note when an output's power is above its device's limit, which cuts it. `source` says what gives the
 * power, such as `"Out"` for a state.
 */
function limitNote(project: Project, deviceName: string, output: Output, source: string, where: DiagnosticLocation, add: Add) {
  const power = output.kind === "power" ? output.value : output.kind === "target" ? output.power : 0;
  const limit = powerLimitOf(project.robot, deviceName);
  if (Math.abs(power) <= limit) return;
  add("info", "device.power.limit", `${source} gives "${deviceName.trim()}" power ${shown(power)}. Its power limit is ${shown(limit)}, so it runs at ${shown(limitPower(power, limit))}.`, where);
}

function validateSubsystems(project: Project, add: Add) {
  const subsystemNames = new Set<string>();
  const hardwareOwners = new Map<string, string>();
  for (const subsystem of project.subsystems) {
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
      if (hardwareName !== device.name) {
        add("warning", "device.name.spaces", `"${hardwareName}" has spaces at the start or end of its name. The robot ignores them; remove them so the name matches the configuration exactly.`, where);
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
        const travel = hardwareEntry(project.robot, device.name)?.travel;
        if (!outputKinds(device.kind).includes(output.kind)) {
          add("error", "state.output.kind", `A ${device.kind === "crservo" ? "continuous rotation servo" : device.kind} cannot be given a ${output.kind}.`, { ...where, deviceId });
        } else if (output.kind === "target" && travel && (output.ticks < travel.minTicks || output.ticks > travel.maxTicks)) {
          add("error", "state.output.travel", `"${state.name}" sends "${device.name}" to ${output.ticks} ticks, outside its travel of ${travel.minTicks} to ${travel.maxTicks}.`, { ...where, deviceId });
        } else {
          limitNote(project, device.name, output, `"${stateName || "This state"}"`, { ...where, deviceId }, add);
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
    const groupDevices = new Map<string, number>();
    for (const step of steps) {
      const where = { ...at, stepId: step.id };
      switch (step.kind) {
        case "path":
          if (!step.pathId) add("error", "step.path.unset", "Choose a path for this action.", where);
          else if (!pathIds.has(step.pathId)) add("error", "step.path.missing", "This step drives a path that no longer exists.", where);
          else driven.push(step.pathId);
          if (step.pathId) groupPaths.push(step.pathId);
          break;
        case "wait":
          if (step.ms > AUTONOMOUS_PERIOD_MS) add("warning", "step.wait.long", "This wait is longer than the 30 second autonomous period.", where);
          break;
        case "state": {
          if (!step.subsystemId) {
            add("error", "step.state.unset", "Choose a mechanism and a state for this action.", where);
            break;
          }
          const subsystem = project.subsystems.find((item) => item.id === step.subsystemId);
          if (!subsystem) add("error", "step.state.subsystem", "This step uses a mechanism that no longer exists.", where);
          else if (!step.stateId) {
            add("error", "step.state.unset", subsystem.states.length
              ? `Choose a state of "${subsystem.name}" for this action.`
              : `"${subsystem.name}" has no states yet. Add one on the Robot page, or choose another mechanism.`, where);
          } else if (!subsystem.states.some((state) => state.id === step.stateId)) add("error", "step.state.missing", `This step uses a state that "${subsystem.name}" no longer has.`, where);
          groupSubsystems.set(step.subsystemId, (groupSubsystems.get(step.subsystemId) ?? 0) + 1);
          break;
        }
        case "device": {
          const kind = deviceKindLabel(step.deviceKind);
          const name = step.device.trim();
          if (!name) {
            add("error", "step.device.unset", `Choose the ${kind} this action sets.`, where);
            break;
          }
          if (!outputKinds(step.deviceKind).includes(step.output.kind)) {
            add("error", "step.device.output", `A ${kind} can't be given ${step.output.kind === "position" ? "a position" : step.output.kind === "target" ? "an encoder target" : "power"}.`, where);
            break;
          }
          const travel = hardwareEntry(project.robot, name)?.travel;
          if (step.output.kind === "target" && travel && (step.output.ticks < travel.minTicks || step.output.ticks > travel.maxTicks)) {
            add("error", "step.device.travel", `This action sends "${name}" to ${step.output.ticks} ticks, outside its travel of ${travel.minTicks} to ${travel.maxTicks}.`, where);
          } else {
            limitNote(project, name, step.output, "This action", where, add);
          }
          const owner = project.subsystems.find((subsystem) => subsystem.devices.some((device) => device.name.trim() === name));
          if (owner) add("info", "step.device.mechanism", `"${name}" is also part of ${owner.name.trim() || "a mechanism"}. This action sets it directly, without changing the mechanism's state.`, where);
          groupDevices.set(name, (groupDevices.get(name) ?? 0) + 1);
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
      for (const [name, count] of groupDevices) {
        if (count > 1) add("warning", "step.group.device", `"${name}" is set more than once at the same time; only the last setting sticks.`, at);
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
    if (!binding.action.subsystemId) {
      add("error", "binding.unset", "Choose a mechanism and its state for this button.", where);
      continue;
    }
    const subsystem = project.subsystems.find((item) => item.id === binding.action.subsystemId);
    if (!subsystem) {
      add("error", "binding.subsystem", "This button controls a mechanism that no longer exists.", where);
      continue;
    }
    const states = binding.action.kind === "state" ? [binding.action.stateId]
      : binding.action.kind === "toggle" ? [binding.action.firstStateId, binding.action.secondStateId]
        : [binding.action.heldStateId, binding.action.releasedStateId];
    if (states.some((stateId) => !stateId)) {
      add("error", "binding.unset", subsystem.states.length
        ? `Choose the ${states.length === 1 ? "state" : "states"} of "${subsystem.name}" for this button.`
        : `"${subsystem.name}" has no states yet. Add one on the Robot page, or choose another mechanism.`, where);
    } else if (states.some((stateId) => !subsystem.states.some((state) => state.id === stateId))) {
      add("error", "binding.state", `This button uses a state that "${subsystem.name}" no longer has.`, where);
    }
    if (states.length === 2 && states[0] && states[0] === states[1]) {
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

/**
 * Where a diagnostic is, in words: its program and action, path or button, or its mechanism, such as
 * `Main Auto · action 8`. Undefined for the project as a whole.
 */
export function describeLocation(project: Project, location: DiagnosticLocation): string | undefined {
  const parts: string[] = [];
  const program = location.programId ? project.programs.find((item) => item.id === location.programId) : undefined;
  if (program) parts.push(program.name.trim() || "Unnamed program");
  if (program?.kind === "autonomous") {
    const number = location.stepId ? actionNumber(program.routine, location.stepId) : undefined;
    if (number) parts.push(`action ${number}`);
    const path = location.pathId ? program.paths.find((item) => item.id === location.pathId) : undefined;
    if (path) parts.push(`path "${label(path)}"`);
  }
  if (program?.kind === "teleop" && location.bindingId) {
    const index = program.bindings.findIndex((item) => item.id === location.bindingId);
    if (index >= 0) parts.push(`button ${index + 1}`);
  }
  const subsystem = location.subsystemId ? project.subsystems.find((item) => item.id === location.subsystemId) : undefined;
  if (subsystem) parts.push(`mechanism "${subsystem.name.trim() || "Unnamed"}"`);
  if (location.hardware) parts.push(`Robot hardware "${location.hardware}"`);
  if (location.robot && !parts.length) parts.push("Robot profile");
  return parts.length ? parts.join(" · ") : undefined;
}

/** An action's number in a routine, such as "3", or "3.2" for the second action of a group. */
export function actionNumber(steps: Step[], stepId: string): string | undefined {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.id === stepId) return String(i + 1);
    if (step.kind === "together" || step.kind === "race") {
      const inner = actionNumber(step.steps, stepId);
      if (inner) return `${i + 1}.${inner}`;
    }
  }
  return undefined;
}
