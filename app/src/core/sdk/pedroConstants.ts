/**
 * Reads the robot facts in a team's Pedro Pathing 3 constants class (the quickstart's
 * `pedro/Constants.java`), so the app's robot profile matches the code the robot runs:
 *
 * - `MecanumConfig`: drive motor names and directions.
 * - The localizer config, such as `PinpointConfig`: device name and pod offsets.
 * - `ForesightConfig`: achievable forward and strafe velocities and natural decelerations.
 * - `TUNED`.
 *
 * Pedro 3 writes each config as a lambda of `c.<setting>.set(<value>)` calls. Only values written
 * as literals are read. A setting whose value is computed is listed in `unreadable` instead of
 * guessed, and the profile keeps its own value for it.
 */
import { DRIVE_MOTOR_POSITIONS, type DriveMotor, type DriveMotorPosition, type RobotLocalizer, type RobotProfile } from "../ir/types";
import { ROBOT_LIMITS } from "../ir/schema";
import { importsOf, maskJava, scanTo, unescapeJavaString } from "../java/source";

export interface PedroConstants {
  /** The `TUNED` flag, or null when the class has none. */
  tuned: boolean | null;
  /** Drive motors, when the class has a `MecanumConfig` that names and directs all four. */
  drivetrain: Record<DriveMotorPosition, DriveMotor> | null;
  localizer: RobotLocalizer | null;
  foresight: Partial<Pick<RobotProfile, "maxForwardVelocity" | "maxStrafeVelocity" | "forwardDeceleration" | "strafeDeceleration">>;
  /** Settings that are present but not written as values, such as `MecanumConfig.frontLeftName`. */
  unreadable: string[];
}

type Value = { kind: "string"; text: string } | { kind: "number"; value: number } | { kind: "constant"; name: string } | { kind: "other" };

const LOCALIZER_PACKAGE = "com.pedropathing.revhub.localizers.";
const MOTOR_SETTINGS: Record<DriveMotorPosition, { name: string; direction: string }> = {
  frontLeft: { name: "frontLeftName", direction: "frontLeftDirection" },
  frontRight: { name: "frontRightName", direction: "frontRightDirection" },
  backLeft: { name: "backLeftName", direction: "backLeftDirection" },
  backRight: { name: "backRightName", direction: "backRightDirection" },
};
const FORESIGHT_SETTINGS = {
  maxAchievableForwardVelocity: "maxForwardVelocity",
  maxAchievableStrafeVelocity: "maxStrafeVelocity",
  naturalForwardDeceleration: "forwardDeceleration",
  naturalStrafeDeceleration: "strafeDeceleration",
} as const;
const INCHES_PER_UNIT: Record<string, number> = { INCH: 1, MM: 1 / 25.4, CM: 1 / 2.54, METER: 1 / 0.0254 };

function parseValue(text: string): Value {
  const trimmed = text.trim();
  const string = /^"((?:[^"\\]|\\.)*)"$/.exec(trimmed);
  if (string) return { kind: "string", text: unescapeJavaString(string[1]) };
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?[dDfF]?$/.test(trimmed)) return { kind: "number", value: Number(trimmed.replace(/[dDfF]$/, "")) };
  const constant = /^(?:[A-Za-z_]\w*\.)*([A-Za-z_]\w*)$/.exec(trimmed);
  if (constant) return { kind: "constant", name: constant[1] };
  return { kind: "other" };
}

/** Every `new XConfig(param -> { ... })` in the class, with the values its body sets. */
function configs(source: string, masked: string) {
  const found: { type: string; settings: Map<string, Value> }[] = [];
  for (const match of masked.matchAll(/\bnew\s+(\w+Config)\s*\(/g)) {
    const open = match.index! + match[0].length;
    const close = scanTo(masked, open, ")");
    if (close < 0) continue;
    const body = masked.slice(open, close - 1);
    const param = /^\s*(?:\(\s*)?([A-Za-z_]\w*)\s*\)?\s*->/.exec(body)?.[1];
    if (!param) continue;
    const settings = new Map<string, Value>();
    for (const call of body.matchAll(new RegExp(`\\b${param}\\s*\\.\\s*(\\w+)\\s*\\.\\s*set\\s*\\(`, "g"))) {
      const start = open + call.index! + call[0].length;
      const end = scanTo(masked, start, ")");
      if (end < 0) continue;
      settings.set(call[1], parseValue(source.slice(start, end - 1)));
    }
    found.push({ type: match[1], settings });
  }
  return found;
}

export function readPedroConstants(source: string): PedroConstants {
  const masked = maskJava(source);
  const unreadable: string[] = [];
  const tunedMatch = /\bboolean\s+TUNED\s*=\s*(true|false)\s*;/.exec(masked);
  const all = configs(source, masked);
  const localizerTypes = new Set(importsOf(source).filter((name) => name.startsWith(LOCALIZER_PACKAGE)).map((name) => name.slice(LOCALIZER_PACKAGE.length)));

  const read = (type: string, settings: Map<string, Value>, setting: string, kind: Value["kind"]) => {
    const value = settings.get(setting);
    if (!value) return undefined;
    if (value.kind !== kind) { unreadable.push(`${type}.${setting}`); return undefined; }
    return value;
  };

  let drivetrain: PedroConstants["drivetrain"] = null;
  const mecanum = all.find((config) => config.type === "MecanumConfig");
  if (mecanum) {
    const motors: Partial<Record<DriveMotorPosition, DriveMotor>> = {};
    for (const position of DRIVE_MOTOR_POSITIONS) {
      const name = read(mecanum.type, mecanum.settings, MOTOR_SETTINGS[position].name, "string");
      const direction = read(mecanum.type, mecanum.settings, MOTOR_SETTINGS[position].direction, "constant");
      if (name?.kind === "string" && direction?.kind === "constant") motors[position] = { name: name.text, reversed: direction.name === "REVERSE" };
    }
    if (DRIVE_MOTOR_POSITIONS.every((position) => motors[position])) drivetrain = motors as Record<DriveMotorPosition, DriveMotor>;
  }

  let localizer: RobotLocalizer | null = null;
  const localizerConfig = all.find((config) => config.type === "PinpointConfig" || localizerTypes.has(config.type));
  if (localizerConfig) {
    const kind = localizerConfig.type.replace(/Config$/, "").toLowerCase();
    localizer = { kind };
    const name = read(localizerConfig.type, localizerConfig.settings, "name", "string");
    if (name?.kind === "string") localizer.name = name.text;
    if (kind === "pinpoint") {
      const unit = read(localizerConfig.type, localizerConfig.settings, "offsetUnits", "constant");
      const scale = unit?.kind === "constant" ? INCHES_PER_UNIT[unit.name] : 1;
      for (const axis of ["xPodOffset", "yPodOffset"] as const) {
        const offset = read(localizerConfig.type, localizerConfig.settings, axis, "number");
        if (offset?.kind === "number" && scale !== undefined) localizer[axis] = Math.round(offset.value * scale * 1000) / 1000;
      }
    }
  }

  const foresight: PedroConstants["foresight"] = {};
  const foresightConfig = all.find((config) => config.type === "ForesightConfig");
  if (foresightConfig) {
    for (const [setting, field] of Object.entries(FORESIGHT_SETTINGS)) {
      const value = read(foresightConfig.type, foresightConfig.settings, setting, "number");
      if (value?.kind !== "number") continue;
      const { min, max } = ROBOT_LIMITS[field];
      // Pedro stores decelerations as positive magnitudes; a negative value still means slowing down.
      const magnitude = Math.abs(value.value);
      if (magnitude < min || magnitude > max) unreadable.push(`ForesightConfig.${setting} (${value.value} is outside ${min}–${max})`);
      else foresight[field] = magnitude;
    }
  }

  return { tuned: tunedMatch ? tunedMatch[1] === "true" : null, drivetrain, localizer, foresight, unreadable };
}

/**
 * The robot profile with every value the constants class sets, or null when nothing would change.
 * `readAt` only moves when a value does, so re-reading an unchanged file is not an edit.
 */
export function syncRobotProfile(robot: RobotProfile, constants: PedroConstants, file: string, now = new Date()): RobotProfile | null {
  const next: RobotProfile = { ...robot, ...constants.foresight };
  if (constants.drivetrain) next.drivetrain = constants.drivetrain;
  if (constants.localizer) next.localizer = constants.localizer;
  const values = { file, tuned: constants.tuned, unreadable: constants.unreadable };
  const same = JSON.stringify({ ...next, constants: values }) === JSON.stringify({ ...robot, constants: robot.constants && { file: robot.constants.file, tuned: robot.constants.tuned, unreadable: robot.constants.unreadable } });
  if (same) return null;
  next.constants = { ...values, readAt: now.toISOString() };
  return next;
}
