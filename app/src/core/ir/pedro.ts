/**
 * The hardware Pedro Pathing drives: the drive motors and the localizer's devices. Pedro already makes
 * every team name these devices in its constants class, so Lumière reads them from there, and from
 * what the robot reports, instead of asking for them again. Mechanisms never get them.
 */
import { DRIVE_MOTOR_POSITIONS, type RobotProfile } from "./types";

const LOCALIZER_LABELS: Record<string, string> = {
  pinpoint: "goBILDA Pinpoint",
  otos: "SparkFun OTOS",
  octoquad: "OctoQuad",
  threewheel: "Three-wheel odometry",
  threewheelimu: "Three-wheel odometry with IMU",
  twowheel: "Two-wheel odometry with IMU",
};

/** A localizer kind as people say it, such as "Three-wheel odometry with IMU" for `threewheelimu`. */
export function localizerLabel(kind: string): string {
  return LOCALIZER_LABELS[kind] ?? `${kind} localizer`;
}

const ROLE_LABELS: Record<string, string> = {
  frontLeft: "front left drive motor",
  frontRight: "front right drive motor",
  backLeft: "back left drive motor",
  backRight: "back right drive motor",
  leftEncoder: "left dead wheel",
  rightEncoder: "right dead wheel",
  strafeEncoder: "strafe dead wheel",
  xPod: "forward dead wheel",
  yPod: "strafe dead wheel",
  imu: "localizer IMU",
  pinpoint: "Pinpoint localizer",
  otos: "OTOS localizer",
  octoquad: "OctoQuad localizer",
};

/** What a device does for Pedro Pathing, in lower case, such as "left dead wheel" for `leftEncoder`. */
export function pedroRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? `Pedro Pathing ${role}`;
}

/** Roles whose device is an encoder input: a dead wheel plugged into a motor port's encoder. */
export const ENCODER_ROLES: ReadonlySet<string> = new Set(["leftEncoder", "rightEncoder", "strafeEncoder", "xPod", "yPod"]);
export const DRIVE_ROLES: ReadonlySet<string> = new Set(DRIVE_MOTOR_POSITIONS);

const ROLE_TYPES: Record<string, string> = { imu: "imu", pinpoint: "pinpoint", otos: "otos", octoquad: "octoquad" };

/** The manifest type a role's device must have, or undefined when Lumière does not know it. */
export function pedroRoleType(role: string): string | undefined {
  return DRIVE_ROLES.has(role) || ENCODER_ROLES.has(role) ? "motor" : ROLE_TYPES[role];
}

export interface OwnedDevice {
  role: string;
  name: string;
  /** Read from the project's Pedro constants, or reported by the robot for a role the constants do not name. */
  source: "constants" | "robot";
}

/**
 * Every device Pedro Pathing drives: the ones the project's Pedro constants name, then the ones the
 * robot reported for roles the constants leave out, such as a setting the constants file computes or
 * a default Pedro fills in.
 */
export function pedroDevices(robot: RobotProfile): OwnedDevice[] {
  const owned: OwnedDevice[] = [];
  const add = (role: string, name: string, source: OwnedDevice["source"]) => {
    const trimmed = name.trim();
    if (trimmed && !owned.some((device) => device.role === role && device.name === trimmed)) owned.push({ role, name: trimmed, source });
  };
  if (robot.drivetrain) for (const position of DRIVE_MOTOR_POSITIONS) add(position, robot.drivetrain[position].name, "constants");
  const localizer = robot.localizer;
  if (localizer?.devices?.length) for (const device of localizer.devices) add(device.role, device.name, "constants");
  else if (localizer?.name) add(localizer.kind, localizer.name, "constants");
  const named = new Set(owned.map((device) => device.role));
  for (const device of robot.scan?.pedro?.devices ?? []) if (!named.has(device.role)) add(device.role, device.name, "robot");
  return owned;
}

/** Roles where the project's constants and the robot name different devices, which means one of them is out of date. */
export function pedroMismatches(robot: RobotProfile): { role: string; constants: string; robot: string }[] {
  const reported = robot.scan?.pedro?.devices;
  if (!reported) return [];
  const fromConstants = pedroDevices({ ...robot, scan: undefined });
  const mismatches: { role: string; constants: string; robot: string }[] = [];
  for (const role of new Set(fromConstants.map((device) => device.role))) {
    const ours = fromConstants.filter((device) => device.role === role).map((device) => device.name);
    const theirs = reported.filter((device) => device.role === role).map((device) => device.name.trim());
    if (theirs.length && !theirs.every((name) => ours.includes(name))) mismatches.push({ role, constants: ours.join(", "), robot: theirs.join(", ") });
  }
  return mismatches;
}
