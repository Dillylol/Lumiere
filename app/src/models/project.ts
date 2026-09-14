import { z } from "zod";

export type ExperienceMode = "beginner" | "advanced";
export type ProgramKind = "autonomous" | "teleop" | "utility";
export type RunTarget = "simulator" | "robot";
export type SaveState = "saved" | "saving" | "unsaved" | "error";

export type ActionKind =
  | "drive"
  | "turn"
  | "wait"
  | "motor"
  | "servo"
  | "stop"
  | "path"
  | "custom";

export interface ProgramAction {
  id: string;
  kind: ActionKind;
  label: string;
  enabled: boolean;
  args: Record<string, string | number | boolean>;
  source: string;
  leadingComments: string[];
}

export interface ProgramIR {
  version: 1;
  actions: ProgramAction[];
}

export interface ProgramDocument {
  id: string;
  name: string;
  kind: ProgramKind;
  source: string;
  draftSource: string;
  sourceRevision: string;
  ir: ProgramIR;
  updatedAt: string;
}

export interface JulesProjectV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  experienceMode: ExperienceMode;
  activeProgramId: string;
  programs: ProgramDocument[];
  robotManifest: Record<string, unknown>;
  guidance: {
    completed: string[];
    dismissed: string[];
  };
  workspace: {
    activeTool: "build" | "paths" | "simulate" | "robot" | "learn";
    bottomPanel: "problems" | "output" | "telemetry";
    inspectorOpen: boolean;
    runTarget: RunTarget;
  };
}

export interface Diagnostic {
  id: string;
  severity: "error" | "warning" | "info";
  line: number;
  column: number;
  endColumn: number;
  message: string;
  suggestion?: string;
}

export interface GuidanceStep {
  id: string;
  title: string;
  description: string;
  complete: boolean;
}

export interface FeatureAvailability {
  available: boolean;
  reason?: string;
}

const actionSchema = z.object({
  id: z.string(),
  kind: z.enum(["drive", "turn", "wait", "motor", "servo", "stop", "path", "custom"]),
  label: z.string(),
  enabled: z.boolean(),
  args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  source: z.string(),
  leadingComments: z.array(z.string()),
});

const programSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  kind: z.enum(["autonomous", "teleop", "utility"]),
  source: z.string(),
  draftSource: z.string(),
  sourceRevision: z.string(),
  ir: z.object({ version: z.literal(1), actions: z.array(actionSchema) }),
  updatedAt: z.string(),
});

export const projectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  experienceMode: z.enum(["beginner", "advanced"]),
  activeProgramId: z.string(),
  programs: z.array(programSchema).min(1),
  robotManifest: z.record(z.string(), z.unknown()),
  guidance: z.object({ completed: z.array(z.string()), dismissed: z.array(z.string()) }),
  workspace: z.object({
    activeTool: z.enum(["build", "paths", "simulate", "robot", "learn"]),
    bottomPanel: z.enum(["problems", "output", "telemetry"]),
    inspectorOpen: z.boolean(),
    runTarget: z.enum(["simulator", "robot"]),
  }),
});

export const DEFAULT_MANIFEST: Record<string, unknown> = {
  type: "manifest",
  motors: ["frontLeft", "frontRight", "backLeft", "backRight"],
  servos: ["claw"],
  imus: ["imu"],
  voltage_sensors: ["Control Hub"],
};

const now = () => new Date().toISOString();
const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export const hashSource = (source: string) => {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const STARTER_SOURCES: Record<ProgramKind, string> = {
  autonomous: `# Drive forward, pause, then stop\ndrive.forward(0.45, 1000)\nwait(250)\nstop()`,
  teleop: `# TeleOp structure will expand with gamepad events\n# Start with a safe mechanism position\nservo.set("claw", 0.5)\nstop()`,
  utility: `# Safely test one configured motor\nmotor.set("frontLeft", 0.25)\nwait(500)\nmotor.set("frontLeft", 0)\nstop()`,
};

export const createProgram = (
  kind: ProgramKind,
  name: string,
  source: string,
  ir: ProgramIR,
): ProgramDocument => ({
  id: makeId("program"),
  name,
  kind,
  source,
  draftSource: source,
  sourceRevision: hashSource(source),
  ir,
  updatedAt: now(),
});

export const createProject = (
  name: string,
  experienceMode: ExperienceMode,
  kind: ProgramKind,
  source: string,
  ir: ProgramIR,
): JulesProjectV1 => {
  const program = createProgram(kind, kind === "teleop" ? "Main TeleOp" : kind === "utility" ? "Hardware Check" : "Main Auto", source, ir);
  const timestamp = now();
  return {
    schemaVersion: 1,
    id: makeId("project"),
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    experienceMode,
    activeProgramId: program.id,
    programs: [program],
    robotManifest: structuredClone(DEFAULT_MANIFEST),
    guidance: { completed: [], dismissed: [] },
    workspace: {
      activeTool: "build",
      bottomPanel: "problems",
      inspectorOpen: true,
      runTarget: "simulator",
    },
  };
};

export const parseProject = (value: unknown): JulesProjectV1 => projectSchema.parse(value) as JulesProjectV1;

export const cloneProject = (project: JulesProjectV1, name = `${project.name} copy`): JulesProjectV1 => {
  const copy = structuredClone(project);
  copy.id = makeId("project");
  copy.name = name;
  copy.createdAt = now();
  copy.updatedAt = copy.createdAt;
  copy.programs = copy.programs.map((program) => ({ ...program, id: makeId("program") }));
  copy.activeProgramId = copy.programs[0].id;
  return copy;
};

