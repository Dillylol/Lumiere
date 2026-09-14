import { BRAND } from "../brand";
import type { Diagnostic, ProgramAction, ProgramIR } from "../models/project";
import { hashSource } from "../models/project";

export interface ParseResult {
  ir: ProgramIR;
  diagnostics: Diagnostic[];
  sourceRevision: string;
}

const makeActionId = (line: number, source: string) => `action-${line}-${hashSource(source)}`;
const numeric = (value: string | undefined) => value !== undefined && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : undefined;
const unquote = (value: string | undefined) => value?.trim().replace(/^["']|["']$/g, "") ?? "";

const definitions = [
  { pattern: /^drive\.(forward|backward|back|left|right)\(([^,]+),\s*([^\)]+)\)$/, kind: "drive" as const },
  { pattern: /^turn\.(left|right)\(([^,]+),\s*([^\)]+)\)$/, kind: "turn" as const },
  { pattern: /^wait\(([^\)]+)\)$/, kind: "wait" as const },
  { pattern: /^motor\.set\(([^,]+),\s*([^\)]+)\)$/, kind: "motor" as const },
  { pattern: /^servo\.set\(([^,]+),\s*([^\)]+)\)$/, kind: "servo" as const },
  { pattern: /^stop\(\)$/, kind: "stop" as const },
  { pattern: /^path\.(linear|tangent|constant|seg)\((.+)\)$/, kind: "path" as const },
];

export function parseJules(source: string): ParseResult {
  const actions: ProgramAction[] = [];
  const diagnostics: Diagnostic[] = [];
  const comments: string[] = [];

  source.split(/\r?\n/).forEach((rawLine, index) => {
    const line = index + 1;
    let text = rawLine.trim();
    let enabled = true;
    if (!text) return;
    if (text.startsWith("# @disabled ")) {
      text = text.slice("# @disabled ".length).trim();
      enabled = false;
    } else if (text.startsWith("#")) {
      comments.push(text.slice(1).trim());
      return;
    }
    if (/^path\.(start|follow)\(\)$/.test(text)) return;

    const definition = definitions.find((item) => item.pattern.test(text));
    if (!definition) {
      diagnostics.push({
        id: `syntax-${line}`,
        severity: "error",
        line,
        column: Math.max(1, rawLine.indexOf(text) + 1),
        endColumn: Math.max(2, rawLine.length + 1),
        message: `${BRAND.name} does not recognize “${text}”.`,
        suggestion: "Choose an action from the guided builder or check the command spelling and parentheses.",
      });
      return;
    }

    const match = text.match(definition.pattern)!;
    const base: ProgramAction = {
      id: makeActionId(line, text),
      kind: definition.kind,
      label: text,
      enabled,
      args: {},
      source: text,
      leadingComments: comments.splice(0),
    };

    if (definition.kind === "drive") {
      const power = numeric(match[2]);
      const duration = numeric(match[3]);
      base.label = `Drive ${match[1]}`;
      base.args = { direction: match[1], power: power ?? 0, duration: duration ?? 0 };
      if (power === undefined || power < 0 || power > 1) diagnostics.push(rangeDiagnostic(line, text, "Drive power must be between 0 and 1."));
      if (duration === undefined || duration < 0) diagnostics.push(rangeDiagnostic(line, text, "Duration must be zero or greater."));
    } else if (definition.kind === "turn") {
      const power = numeric(match[2]);
      const duration = numeric(match[3]);
      base.label = `Turn ${match[1]}`;
      base.args = { direction: match[1], power: power ?? 0, duration: duration ?? 0 };
      if (power === undefined || power < 0 || power > 1) diagnostics.push(rangeDiagnostic(line, text, "Turn power must be between 0 and 1."));
      if (duration === undefined || duration < 0) diagnostics.push(rangeDiagnostic(line, text, "Duration must be zero or greater."));
    } else if (definition.kind === "wait") {
      const duration = numeric(match[1]);
      base.label = "Wait";
      base.args = { duration: duration ?? 0 };
      if (duration === undefined || duration < 0) diagnostics.push(rangeDiagnostic(line, text, "Wait duration must be zero or greater."));
    } else if (definition.kind === "motor") {
      const power = numeric(match[2]);
      base.label = `Set motor ${unquote(match[1])}`;
      base.args = { device: unquote(match[1]), power: power ?? 0 };
      if (power === undefined || power < -1 || power > 1) diagnostics.push(rangeDiagnostic(line, text, "Motor power must be between -1 and 1."));
    } else if (definition.kind === "servo") {
      const position = numeric(match[2]);
      base.label = `Set servo ${unquote(match[1])}`;
      base.args = { device: unquote(match[1]), position: position ?? 0 };
      if (position === undefined || position < 0 || position > 1) diagnostics.push(rangeDiagnostic(line, text, "Servo position must be between 0 and 1."));
    } else if (definition.kind === "stop") {
      base.label = "Stop all motion";
    } else if (definition.kind === "path") {
      base.label = `Follow ${match[1]} path segment`;
      base.args = { mode: match[1], values: match[2] };
    }
    actions.push(base);
  });

  return { ir: { version: 1, actions }, diagnostics, sourceRevision: hashSource(source) };
}

function rangeDiagnostic(line: number, source: string, message: string): Diagnostic {
  return {
    id: `range-${line}-${message}`,
    severity: "error",
    line,
    column: 1,
    endColumn: source.length + 1,
    message,
    suggestion: "Use the value range shown by completion or the visual property inspector.",
  };
}

export function actionToSource(action: ProgramAction): string {
  const comments = action.leadingComments.map((comment) => `# ${comment}`).join("\n");
  let statement = action.source;
  if (action.kind === "drive") statement = `drive.${action.args.direction}(${action.args.power}, ${action.args.duration})`;
  if (action.kind === "turn") statement = `turn.${action.args.direction}(${action.args.power}, ${action.args.duration})`;
  if (action.kind === "wait") statement = `wait(${action.args.duration})`;
  if (action.kind === "motor") statement = `motor.set("${action.args.device}", ${action.args.power})`;
  if (action.kind === "servo") statement = `servo.set("${action.args.device}", ${action.args.position})`;
  if (action.kind === "stop") statement = "stop()";
  if (action.kind === "path") statement = `path.${action.args.mode}(${action.args.values})`;
  return [comments, action.enabled ? statement : `# @disabled ${statement}`].filter(Boolean).join("\n");
}

export const generateJules = (ir: ProgramIR) => ir.actions.map(actionToSource).join("\n");

export function generateJava(ir: ProgramIR, className: string, kind: "autonomous" | "teleop" | "utility"): string {
  const safeClass = className.replace(/[^a-zA-Z0-9_]/g, "") || `${BRAND.java.classPrefix}Program`;
  const annotation = kind === "teleop" ? `@TeleOp(name = "${className}")` : `@Autonomous(name = "${className}")`;
  const body = ir.actions.map((action) => {
    if (!action.enabled) return `        // Disabled: ${action.source}`;
    if (action.kind === "drive") return `        robot.drive.${action.args.direction}(${action.args.power}, ${action.args.duration});`;
    if (action.kind === "turn") return `        robot.turn.${action.args.direction}(${action.args.power}, ${action.args.duration});`;
    if (action.kind === "wait") return `        sleep(${action.args.duration});`;
    if (action.kind === "motor") return `        robot.motor("${action.args.device}").setPower(${action.args.power});`;
    if (action.kind === "servo") return `        robot.servo("${action.args.device}").setPosition(${action.args.position});`;
    if (action.kind === "stop") return "        robot.stopAll();";
    if (action.kind === "path") return `        // Pedro: ${action.source}`;
    return `        // ${BRAND.name}: ${action.source}`;
  }).join("\n");
  return `package org.firstinspires.ftc.teamcode;\n\nimport com.qualcomm.robotcore.eventloop.opmode.${kind === "teleop" ? "TeleOp" : "Autonomous"};\nimport com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;\n\n${annotation}\npublic final class ${safeClass} extends LinearOpMode {\n    @Override\n    public void runOpMode() throws InterruptedException {\n        ${BRAND.java.classPrefix}Robot robot = new ${BRAND.java.classPrefix}Robot(hardwareMap, telemetry);\n        robot.initialize();\n        waitForStart();\n        if (isStopRequested()) return;\n\n${body}\n    }\n}\n`;
}

export const JULES_SNIPPETS = [
  { label: "drive.forward", insertText: "drive.forward(0.5, 1000)", detail: "Drive forward: power 0–1, duration in milliseconds" },
  { label: "drive.left", insertText: "drive.left(0.4, 750)", detail: "Strafe left" },
  { label: "turn.right", insertText: "turn.right(0.35, 500)", detail: "Turn right" },
  { label: "wait", insertText: "wait(250)", detail: "Wait in milliseconds" },
  { label: "motor.set", insertText: "motor.set(\"frontLeft\", 0.25)", detail: "Set motor power from -1 to 1" },
  { label: "servo.set", insertText: "servo.set(\"claw\", 0.5)", detail: "Set servo position from 0 to 1" },
  { label: "stop", insertText: "stop()", detail: "Stop all robot motion" },
];
