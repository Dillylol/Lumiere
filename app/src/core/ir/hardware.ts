/**
 * The robot's hardware list: every motor, servo and continuous servo the project knows, and each one's
 * settings (direction, power limit, encoder travel). Mechanisms and direct actions name devices from it,
 * and every use of a device follows its settings, in deployed code and in Lumière Live.
 *
 * The project stores entries only for devices whose settings the team set, or that they added by name.
 * Every other device the robot reported, or that a mechanism or action names, is in the list with the
 * default settings: forward, no power limit and no travel range.
 */
import { DRIVE_ROLES, pedroDevices } from "./pedro";
import type { DeviceKind, DeviceStep, HardwareDevice, Output, Project, RobotProfile, Step, Subsystem } from "./types";

export const DEVICE_KINDS: readonly DeviceKind[] = ["motor", "servo", "crservo"];

/** Whether a manifest type is a device Lumière drives. Sensors and other devices are listed only. */
export const isDeviceKind = (type: string): type is DeviceKind => (DEVICE_KINDS as readonly string[]).includes(type);

/** A device kind in words, such as "continuous servo". */
export function deviceKindLabel(kind: DeviceKind): string {
  return kind === "crservo" ? "continuous servo" : kind;
}

/** A device kind as a title, such as "Continuous servo". */
export function deviceKindTitle(kind: DeviceKind): string {
  const label = deviceKindLabel(kind);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** The outputs a device kind takes: positions for servos, power for continuous servos, power or encoder targets for motors. */
export function outputKinds(kind: DeviceKind): Output["kind"][] {
  return kind === "servo" ? ["position"] : kind === "crservo" ? ["power"] : ["power", "target"];
}

/** The output a new action or state gives a device kind: power 0, or position 0 for a servo. */
export function defaultOutput(kind: DeviceKind): Output {
  return kind === "servo" ? { kind: "position", value: 0 } : { kind: "power", value: 0 };
}

/** Where a project uses a device: one of a mechanism's devices, or an action in an autonomous routine. */
export type DeviceUse =
  | { kind: DeviceKind; subsystem: Subsystem; deviceId: string }
  | { kind: DeviceKind; programId: string; step: DeviceStep };

/** Every mechanism device and direct action, by the device's configured name. Unnamed ones are left out. */
export function deviceUses(project: Project): Map<string, DeviceUse[]> {
  const uses = new Map<string, DeviceUse[]>();
  const add = (name: string, use: DeviceUse) => {
    const trimmed = name.trim();
    if (trimmed) uses.set(trimmed, [...(uses.get(trimmed) ?? []), use]);
  };
  for (const subsystem of project.subsystems) for (const device of subsystem.devices) add(device.name, { kind: device.kind, subsystem, deviceId: device.id });
  const visit = (programId: string, steps: Step[]) => {
    for (const step of steps) {
      if (step.kind === "device") add(step.device, { kind: step.deviceKind, programId, step });
      else if (step.kind === "together" || step.kind === "race") visit(programId, step.steps);
    }
  };
  for (const program of project.programs) if (program.kind === "autonomous") visit(program.id, program.routine);
  return uses;
}

/** The outputs a use sends its device: every state's output for a mechanism device, or the action's own. */
export function useOutputs(use: DeviceUse): Output[] {
  if ("step" in use) return [use.step.output];
  return use.subsystem.states.flatMap((state) => state.outputs[use.deviceId] ? [state.outputs[use.deviceId]] : []);
}

/** The project's own entry for a device, by its configured name. */
export function hardwareEntry(robot: RobotProfile, name: string): HardwareDevice | undefined {
  const trimmed = name.trim();
  return robot.hardware?.find((device) => device.name === trimmed);
}

/** The most power a device is given: its limit, or 1 when it has none. */
export function powerLimitOf(robot: RobotProfile, name: string): number {
  return hardwareEntry(robot, name)?.powerLimit ?? 1;
}

/** A power cut to a limit, keeping its direction. */
export function limitPower(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/**
 * The hardware list: the project's entries first, then the motors and servos the robot reported, then
 * devices that mechanisms and actions name and that are neither. Pedro Pathing's drive motors are left
 * out, because nothing else may drive them. Dead-wheel ports stay: the motor on such a port can still be
 * given power.
 */
export function hardwareList(project: Project): HardwareDevice[] {
  const robot = project.robot;
  const drive = new Set(pedroDevices(robot).filter((device) => DRIVE_ROLES.has(device.role)).map((device) => device.name));
  const list: HardwareDevice[] = [];
  const seen = new Set<string>();
  const add = (device: HardwareDevice) => {
    if (seen.has(device.name)) return;
    seen.add(device.name);
    list.push(device);
  };
  for (const device of robot.hardware ?? []) add(device);
  for (const device of robot.scan?.devices ?? []) if (isDeviceKind(device.type) && !drive.has(device.name)) add({ name: device.name, kind: device.type, reversed: false });
  for (const [name, uses] of deviceUses(project)) if (!drive.has(name)) add({ name, kind: uses[0].kind, reversed: false });
  return list;
}

/** The robot with a device's entry added, or replaced in place when it already has one. */
export function withHardware(robot: RobotProfile, device: HardwareDevice): RobotProfile {
  const list = robot.hardware ?? [];
  const index = list.findIndex((item) => item.name === device.name);
  return { ...robot, hardware: index < 0 ? [...list, device] : list.map((item, i) => (i === index ? device : item)) };
}

/** The robot without a device's entry, so the device goes back to the default settings. */
export function withoutHardware(robot: RobotProfile, name: string): RobotProfile {
  const next: RobotProfile = { ...robot, hardware: (robot.hardware ?? []).filter((item) => item.name !== name) };
  if (!next.hardware?.length) delete next.hardware;
  return next;
}
