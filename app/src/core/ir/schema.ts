import { z } from "zod";
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type AtomicPath,
  type Heading,
  type Project,
  type Step,
} from "./types";

const finite = z.number().finite();
const id = z.string().min(1).max(100);
const name = z.string().max(120);

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

export const stepSchema: z.ZodType<Step> = z.lazy(() => z.discriminatedUnion("kind", [
  z.object({ id, kind: z.literal("path"), pathId: id }),
  z.object({ id, kind: z.literal("wait"), ms: z.number().finite().min(0).max(600_000) }),
  z.object({ id, kind: z.literal("state"), subsystemId: id, stateId: id }),
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
  z.object({ kind: z.literal("state"), subsystemId: id, stateId: id }),
  z.object({ kind: z.literal("toggle"), subsystemId: id, firstStateId: id, secondStateId: id }),
  z.object({ kind: z.literal("hold"), subsystemId: id, heldStateId: id, releasedStateId: id }),
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

const output = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("power"), value: z.number().min(-1).max(1) }),
  z.object({ kind: z.literal("position"), value: z.number().min(0).max(1) }),
  z.object({ kind: z.literal("target"), ticks: z.number().int().min(-1_000_000).max(1_000_000), power: z.number().min(0).max(1) }),
]);

const subsystem = z.object({
  id,
  name,
  devices: z.array(z.object({
    id,
    name: z.string().max(60),
    kind: z.enum(["motor", "servo", "crservo"]),
    reversed: z.boolean(),
  })).max(20),
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
    widthInches: z.number().min(4).max(36),
    lengthInches: z.number().min(4).max(36),
    maxVelocity: z.number().gt(0).max(200),
    maxAcceleration: z.number().gt(0).max(1000),
  }),
  subsystems: z.array(subsystem).max(30),
  programs: z.array(program).max(50),
}) as z.ZodType<Project>;

/** Parses and checks the structure of a stored project. Throws a ZodError when it is invalid. */
export function parseProject(value: unknown): Project {
  return projectSchema.parse(value);
}

/** Like {@link parseProject}, but returns a readable message instead of throwing. */
export function safeParseProject(value: unknown): { ok: true; project: Project } | { ok: false; error: string } {
  const result = projectSchema.safeParse(value);
  if (result.success) return { ok: true, project: result.data };
  const issue = result.error.issues[0];
  const where = issue.path.length ? ` at ${issue.path.join(".")}` : "";
  return { ok: false, error: `${issue.message}${where}` };
}
