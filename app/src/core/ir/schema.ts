import { z } from "zod";
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type AtomicPath,
  type Heading,
  type Project,
  type Step,
} from "./types";
import { migrateProject } from "./migrate";

const finite = z.number().finite();
const id = z.string().min(1).max(100);
/**
 * A reference an action or button makes to a path, mechanism or state. It may be empty while the team
 * has not chosen one yet: validation reports it, and blocks generating code, but saving still works.
 */
const ref = z.string().max(100);
const name = z.string().max(120);

/**
 * Robot profile bounds, shared with the forms that edit it. Motion values only need to be above
 * zero here, so upgraded version 2 projects always load; forms start at the minimum.
 */
export const ROBOT_LIMITS = {
  widthInches: { min: 4, max: 36 },
  lengthInches: { min: 4, max: 36 },
  maxForwardVelocity: { min: 1, max: 200 },
  maxStrafeVelocity: { min: 1, max: 200 },
  forwardDeceleration: { min: 1, max: 1000 },
  strafeDeceleration: { min: 1, max: 1000 },
  acceleration: { min: 1, max: 1000 },
  turnRateDeg: { min: 10, max: 1440 },
} as const;
const motion = (key: keyof typeof ROBOT_LIMITS) => z.number().gt(0).max(ROBOT_LIMITS[key].max);
const driveMotor = z.object({ name: z.string().max(60), reversed: z.boolean() });

const point = z.object({ x: finite, y: finite });
const startPose = z.object({ x: finite, y: finite, headingDeg: finite });

const progress = z.number().min(0).max(1);

const headingSegment = z.union([
  z.object({ startProgress: progress, endProgress: progress, type: z.literal("linear"), startDeg: finite, endDeg: finite }),
  z.object({ startProgress: progress, endProgress: progress, type: z.literal("constant"), degrees: finite }),
  z.object({ startProgress: progress, endProgress: progress, type: z.literal("tangential"), reverse: z.boolean() }),
  z.object({ startProgress: progress, endProgress: progress, type: z.literal("facingPoint"), point }),
]);

export const headingSchema: z.ZodType<Heading> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("linear"), startDeg: finite, endDeg: finite }),
  z.object({ type: z.literal("constant"), degrees: finite }),
  z.object({ type: z.literal("tangential"), reverse: z.boolean() }),
  z.object({ type: z.literal("piecewise"), segments: z.array(headingSegment).min(1).max(20) }),
]);

const atomicPath: z.ZodType<AtomicPath> = z.object({
  id,
  name,
  color: z.string().max(40),
  kind: z.literal("atomic"),
  end: point,
  controlPoints: z.array(point).max(16),
  heading: headingSchema,
});

const pathDoc = z.discriminatedUnion("kind", [
  atomicPath as z.ZodType<AtomicPath> & z.ZodObject,
  z.object({
    id,
    name,
    color: z.string().max(40),
    kind: z.literal("compound"),
    segments: z.array(atomicPath).min(1).max(50),
    heading: headingSchema.nullable(),
  }),
]);

const output = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("power"), value: z.number().min(-1).max(1) }),
  z.object({ kind: z.literal("position"), value: z.number().min(0).max(1) }),
  z.object({ kind: z.literal("target"), ticks: z.number().int().min(-1_000_000).max(1_000_000), power: z.number().min(0).max(1) }),
]);
const deviceKind = z.enum(["motor", "servo", "crservo"]);
const deviceName = z.string().max(60);
const ticks = z.number().int().min(-1_000_000).max(1_000_000);

const durationMs = z.number().finite().gt(0).max(600_000);

export const stepSchema: z.ZodType<Step> = z.lazy(() => z.discriminatedUnion("kind", [
  z.object({ id, kind: z.literal("path"), pathId: ref }),
  z.object({ id, kind: z.literal("wait"), ms: z.number().finite().min(0).max(600_000) }),
  z.object({ id, kind: z.literal("state"), subsystemId: ref, stateId: ref, duration: z.object({ ms: durationMs, thenStateId: ref }).optional() }),
  // The device may be empty while the team has not chosen one, like the references above.
  z.object({
    id, kind: z.literal("device"), device: deviceName, deviceKind, output,
    duration: z.object({ ms: durationMs, thenPosition: z.number().min(0).max(1).optional() }).optional(),
  }),
  z.object({ id, kind: z.literal("together"), steps: z.array(stepSchema).max(50) }),
  z.object({ id, kind: z.literal("race"), steps: z.array(stepSchema).max(50) }),
]));

const button = z.enum([
  "a", "b", "x", "y",
  "dpad_up", "dpad_down", "dpad_left", "dpad_right",
  "left_bumper", "right_bumper",
  "left_stick_button", "right_stick_button",
  "back", "start", "guide",
]);

const bindingAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("state"), subsystemId: ref, stateId: ref }),
  z.object({ kind: z.literal("toggle"), subsystemId: ref, firstStateId: ref, secondStateId: ref }),
  z.object({ kind: z.literal("hold"), subsystemId: ref, heldStateId: ref, releasedStateId: ref }),
]);

const program = z.discriminatedUnion("kind", [
  z.object({
    id,
    kind: z.literal("autonomous"),
    name,
    group: name,
    preselectTeleOp: name.nullable(),
    start: startPose,
    paths: z.array(pathDoc).max(100),
    routine: z.array(stepSchema).max(200),
  }),
  z.object({
    id,
    kind: z.literal("teleop"),
    name,
    group: name,
    drive: z.object({
      fieldCentric: z.boolean(),
      slowModeButton: button.nullable(),
      slowModeScale: z.number().gt(0).max(1),
      resetHeadingButton: button.nullable(),
    }),
    start: startPose,
    bindings: z.array(z.object({
      id,
      gamepad: z.union([z.literal(1), z.literal(2)]),
      button,
      action: bindingAction,
    })).max(60),
  }),
]);

const subsystem = z.object({
  id,
  name,
  devices: z.array(z.object({ id, name: deviceName, kind: deviceKind })).max(20),
  states: z.array(z.object({
    id,
    name,
    outputs: z.record(z.string(), output),
  })).max(30),
  initialStateId: id.nullable(),
});

export const projectSchema: z.ZodType<Project> = z.object({
  format: z.literal(PROJECT_FORMAT),
  version: z.literal(PROJECT_VERSION),
  id,
  name: z.string().min(1).max(120),
  createdAt: z.string(),
  updatedAt: z.string(),
  robot: z.object({
    widthInches: z.number().min(ROBOT_LIMITS.widthInches.min).max(ROBOT_LIMITS.widthInches.max),
    lengthInches: z.number().min(ROBOT_LIMITS.lengthInches.min).max(ROBOT_LIMITS.lengthInches.max),
    maxForwardVelocity: motion("maxForwardVelocity"),
    maxStrafeVelocity: motion("maxStrafeVelocity"),
    forwardDeceleration: motion("forwardDeceleration"),
    strafeDeceleration: motion("strafeDeceleration"),
    acceleration: motion("acceleration"),
    turnRateDeg: motion("turnRateDeg"),
    drivetrain: z.object({ frontLeft: driveMotor, frontRight: driveMotor, backLeft: driveMotor, backRight: driveMotor }).optional(),
    localizer: z.object({
      kind: z.string().min(1).max(40),
      name: z.string().max(60).optional(),
      xPodOffset: finite.optional(),
      yPodOffset: finite.optional(),
      devices: z.array(z.object({
        role: z.string().min(1).max(40),
        name: z.string().max(80),
        reversed: z.boolean().optional(),
        inchesPerTick: finite.optional(),
      })).max(20).optional(),
    }).optional(),
    constants: z.object({
      file: z.string().max(400),
      readAt: z.string().max(40),
      tuned: z.boolean().nullable(),
      unreadable: z.array(z.string().max(160)).max(40),
    }).optional(),
    scan: z.object({
      devices: z.array(z.object({ name: z.string().max(80), type: z.string().max(80) })).max(300),
      scannedAt: z.string().max(40),
      pedro: z.object({
        constants: z.string().max(200),
        localizer: z.string().max(40).nullable(),
        devices: z.array(z.object({ role: z.string().min(1).max(40), name: z.string().max(80) })).max(40),
      }).optional(),
    }).optional(),
    hardware: z.array(z.object({
      name: deviceName.min(1),
      kind: deviceKind,
      reversed: z.boolean(),
      powerLimit: z.number().gt(0).max(1).optional(),
      travel: z.object({ minTicks: ticks, maxTicks: ticks }).optional(),
    })).max(100).optional(),
  }),
  subsystems: z.array(subsystem).max(30),
  programs: z.array(program).max(50),
}) as z.ZodType<Project>;

/**
 * Parses and checks the structure of a stored project, upgrading a version 2 or 3 project first.
 * Throws a ZodError when it is invalid.
 */
export function parseProject(value: unknown): Project {
  return projectSchema.parse(migrateProject(value));
}

/** Like {@link parseProject}, but returns a readable message instead of throwing. */
export function safeParseProject(value: unknown): { ok: true; project: Project } | { ok: false; error: string } {
  const upgraded = migrateProject(value);
  const result = projectSchema.safeParse(upgraded);
  if (result.success) return { ok: true, project: result.data };
  return { ok: false, error: describeIssue(result.error.issues[0], upgraded) };
}

/** What a field is called on screen, by its name in the project. */
const FIELD_NAMES: Record<string, string> = {
  pathId: "path", subsystemId: "mechanism", stateId: "state", firstStateId: "first state", secondStateId: "second state",
  heldStateId: "state while held", releasedStateId: "state when released", initialStateId: "starting state", ms: "wait time",
  name: "name", group: "group", preselectTeleOp: "TeleOp to select next", slowModeScale: "slow mode scale",
  widthInches: "width", lengthInches: "length", maxForwardVelocity: "forward speed", maxStrafeVelocity: "strafe speed",
  forwardDeceleration: "forward deceleration", strafeDeceleration: "strafe deceleration", acceleration: "acceleration",
  turnRateDeg: "turn rate", headingDeg: "heading", minTicks: "lowest travel", maxTicks: "highest travel", ticks: "target",
  value: "value", power: "power", device: "device", deviceKind: "device type", powerLimit: "power limit", kind: "type",
  thenStateId: "state after", thenPosition: "position after",
};

type Issue = { code: string; path: PropertyKey[]; message: string; origin?: string; minimum?: unknown; maximum?: unknown; inclusive?: boolean };

/**
 * Describes what is wrong with a project in words a team can act on: the program, action, mechanism or
 * path it concerns, and what is wrong with it, instead of the stored structure. Other errors give their
 * message. `value` is the project that failed, used to name its parts.
 */
export function describeProjectError(error: unknown, value?: unknown): string {
  if (error instanceof z.ZodError) {
    const issues = error.issues.slice(0, 3).map((issue) => describeIssue(issue as Issue, value));
    const more = error.issues.length - issues.length;
    return [...issues, ...(more > 0 ? [`…and ${more} more.`] : [])].join("\n");
  }
  return error instanceof Error ? error.message : String(error);
}

function describeIssue(issue: Issue, value: unknown): string {
  const places: string[] = [];
  let field = "";
  let node: unknown = value;
  let action: number[] | null = null;
  const named = (item: unknown, fallback: string) => {
    const text = item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string" ? (item as { name: string }).name.trim() : "";
    return text ? `"${text}"` : fallback;
  };
  const flushAction = () => { if (action) places.push(`action ${action.join(".")}`); action = null; };
  for (let i = 0; i < issue.path.length; i++) {
    const key = issue.path[i];
    const next = issue.path[i + 1];
    const child = node && typeof node === "object" ? (node as Record<PropertyKey, unknown>)[key] : undefined;
    if (typeof next === "number" && (key === "routine" || key === "steps")) {
      action = key === "routine" ? [next + 1] : [...(action ?? []), next + 1];
      node = Array.isArray(child) ? child[next] : undefined;
      i++;
      continue;
    }
    flushAction();
    if (typeof next === "number") {
      const item = Array.isArray(child) ? child[next] : undefined;
      if (key === "programs") places.push(named(item, `program ${next + 1}`));
      else if (key === "subsystems") places.push(`mechanism ${named(item, String(next + 1))}`);
      else if (key === "states") places.push(`state ${named(item, String(next + 1))}`);
      else if (key === "devices" || key === "hardware") places.push(`device ${named(item, String(next + 1))}`);
      else if (key === "paths" || key === "segments") places.push(`${key === "paths" ? "path" : "segment"} ${named(item, String(next + 1))}`);
      else if (key === "bindings") places.push(`button ${next + 1}`);
      else places.push(`${FIELD_NAMES[String(key)] ?? String(key)} ${next + 1}`);
      node = item;
      i++;
      continue;
    }
    if (key === "robot") places.push("the robot profile");
    else if (key === "start") places.push("the start pose");
    // An action's time is "the duration", not a wait time.
    else if (i === issue.path.length - 1) field = key === "ms" && issue.path[i - 1] === "duration" ? "duration" : FIELD_NAMES[String(key)] ?? String(key);
    node = child;
  }
  flushAction();
  // An exclusive bound, such as a duration that must be more than 0, allows neither the bound nor beyond it.
  const problem = issue.code === "too_small"
    ? issue.origin === "string" ? "is empty" : issue.origin === "array" ? "has too few items"
      : issue.inclusive === false ? `must be above ${String(issue.minimum)}` : `is below ${String(issue.minimum)}`
    : issue.code === "too_big"
      ? issue.origin === "string" ? "is too long" : issue.origin === "array" ? "has too many items"
        : issue.inclusive === false ? `must be below ${String(issue.maximum)}` : `is above ${String(issue.maximum)}`
      : issue.code === "invalid_type" ? "is missing or not valid"
        : issue.code === "invalid_value" || issue.code === "invalid_union" ? "is not an allowed value"
          : issue.message.charAt(0).toLowerCase() + issue.message.slice(1);
  const what = field ? `the ${field} ${problem}` : problem;
  const sentence = places.length ? `${places.join(", ")}: ${what}.` : `The project ${what}.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
