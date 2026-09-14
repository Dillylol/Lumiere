/**
 * Applies Pedro Pathing AutoTune output to a robot project's `pedro/Constants.java` and, when the
 * localizer type changes, `pedro/Tuning.java`. AutoTune prints complete field declarations such as
 * `public static MecanumConfig drivetrainConfig = new MecanumConfig(c -> { ... });`.
 */
import { addImports, braceDepths, importsOf, maskJava, scanTo } from "./source";

export interface TunerDeclaration {
  type: string;
  field: string;
  code: string;
}

export interface TunerApplyResult {
  source: string;
  /** Fields whose declarations were replaced. */
  replaced: string[];
  /** Fields in the output that Constants.java does not declare. */
  missing: string[];
  importsAdded: string[];
  /** Set when the localizer type changed; Tuning.java needs `updateTuningLocalizer` with these types. */
  localizerChange?: { from: string; to: string };
  /** Things the user should know, in plain sentences. */
  notes: string[];
}

const LOCALIZER_PACKAGE = "com.pedropathing.revhub.localizers";
const LOCALIZER_CONFIGS = new Set(["PinpointConfig", "ThreeWheelConfig", "ThreeWheelIMUConfig", "TwoWheelConfig", "OTOSConfig", "OctoQuadConfig"]);

/** Packages of every type AutoTune output refers to, taken from the tuning procedures' own imports. */
export const TUNER_IMPORTS: Record<string, string> = {
  MecanumConfig: "com.pedropathing.revhub.drivetrains.MecanumConfig",
  ForesightConfig: "com.pedropathing.algorithm.ForesightConfig",
  Controller: "com.pedropathing.controllers.Controller",
  Matrix: "com.pedropathing.math.Matrix",
  Vector2D: "com.pedropathing.math.Vector2D",
  Pose: "com.pedropathing.math.Pose",
  Encoder: `${LOCALIZER_PACKAGE}.Encoder`,
  RevHubIMU: `${LOCALIZER_PACKAGE}.RevHubIMU`,
  RevHubOrientationOnRobot: "com.qualcomm.hardware.rev.RevHubOrientationOnRobot",
  GoBildaPinpointDriver: "com.qualcomm.hardware.gobilda.GoBildaPinpointDriver",
  OctoQuad: "com.qualcomm.hardware.digitalchickenlabs.OctoQuad",
  DcMotorSimple: "com.qualcomm.robotcore.hardware.DcMotorSimple",
  DistanceUnit: "org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit",
  OptionalDouble: "java.util.OptionalDouble",
  ...Object.fromEntries([...LOCALIZER_CONFIGS].map((type) => [type, `${LOCALIZER_PACKAGE}.${type}`])),
};

const DECLARATION = /\bpublic\s+static\s+(?:final\s+)?([A-Z][\w$]*)\s+([a-z_$][\w$]*)\s*=/g;

/** Reads the field declarations from text copied out of AutoTune. */
export function parseTunerOutput(text: string): TunerDeclaration[] {
  const masked = maskJava(text);
  const declarations: TunerDeclaration[] = [];
  for (const match of masked.matchAll(DECLARATION)) {
    const end = scanTo(masked, match.index + match[0].length, ";");
    if (end < 0) continue;
    declarations.push({ type: match[1], field: match[2], code: text.slice(match.index, end) });
  }
  return declarations;
}

const localizerClass = (configType: string) => configType.replace(/Config$/, "Localizer");

function indentAfterFirstLine(code: string, indent: string): string {
  return code
    .split("\n")
    .map((line, index) => (index === 0 || !line.trim() ? line.trimEnd() : indent + line.trimEnd()))
    .join("\n");
}

function replaceImport(source: string, from: string, to: string): string {
  const pattern = new RegExp(`^([ \\t]*import\\s+)${from.replace(/\./g, "\\.")}(\\s*;)`, "m");
  return source.replace(pattern, `$1${to}$2`);
}

/** Types referred to by simple name in code (outside strings and comments). */
function referencedTypes(code: string): Set<string> {
  return new Set([...maskJava(code).matchAll(/\b([A-Z][\w$]*)\b/g)].map((match) => match[1]));
}

/**
 * Replaces the matching field declarations in Constants.java with AutoTune's output, adds any missing
 * imports, and switches the localizer created in `create` when the localizer type changes.
 */
export function applyTunerOutput(constantsSource: string, tunerOutput: string): TunerApplyResult {
  const declarations = parseTunerOutput(tunerOutput);
  if (!declarations.length) {
    throw new Error("No configuration was found. Copy the whole code block that AutoTune shows after a procedure finishes.");
  }
  let source = constantsSource;
  const result: TunerApplyResult = { source, replaced: [], missing: [], importsAdded: [], notes: [] };

  for (const declaration of declarations) {
    const masked = maskJava(source);
    const depths = braceDepths(masked);
    const pattern = new RegExp(`\\b((?:(?:public|protected|private|static|final)\\s+)*)([A-Z][\\w$]*)\\s+${declaration.field}\\s*=`, "g");
    const existing = [...masked.matchAll(pattern)].find((match) => depths[match.index] === 1 && /\bstatic\b/.test(match[1]));
    if (!existing) {
      result.missing.push(declaration.field);
      continue;
    }
    const end = scanTo(masked, existing.index + existing[0].length, ";");
    if (end < 0) throw new Error(`Could not find the end of ${declaration.field} in Constants.java.`);
    const lineStart = source.lastIndexOf("\n", existing.index) + 1;
    const indent = /^[ \t]*/.exec(source.slice(lineStart))![0];
    source = source.slice(0, existing.index) + indentAfterFirstLine(declaration.code, indent) + source.slice(end);
    result.replaced.push(declaration.field);

    const previousType = existing[2];
    if (previousType !== declaration.type) {
      if (LOCALIZER_CONFIGS.has(previousType) && LOCALIZER_CONFIGS.has(declaration.type)) {
        const from = localizerClass(previousType);
        const to = localizerClass(declaration.type);
        source = source.replace(new RegExp(`\\bnew\\s+${from}\\s*\\(`, "g"), `new ${to}(`);
        source = replaceImport(source, `${LOCALIZER_PACKAGE}.${previousType}`, `${LOCALIZER_PACKAGE}.${declaration.type}`);
        source = replaceImport(source, `${LOCALIZER_PACKAGE}.${from}`, `${LOCALIZER_PACKAGE}.${to}`);
        result.localizerChange = { from: previousType, to: declaration.type };
        result.notes.push(`The localizer changed from ${from} to ${to}. Update Tuning.java too, then run the ${to.replace(/Localizer$/, "")} tuner.`);
        if (declaration.type !== "PinpointConfig") {
          result.notes.push("The desktop simulator models the goBILDA Pinpoint only, so simulated runs of this robot will not track position.");
        }
      } else {
        result.notes.push(`${declaration.field} changed type from ${previousType} to ${declaration.type}. Check the code that uses it.`);
      }
    }
  }

  const imported = new Set(importsOf(source).map((name) => name.slice(name.lastIndexOf(".") + 1)));
  const needed = new Set<string>();
  for (const declaration of declarations) {
    if (!result.replaced.includes(declaration.field)) continue;
    for (const type of referencedTypes(declaration.code)) {
      if (!imported.has(type) && TUNER_IMPORTS[type]) needed.add(TUNER_IMPORTS[type]);
    }
    if (result.localizerChange && !imported.has(localizerClass(result.localizerChange.to))) {
      needed.add(`${LOCALIZER_PACKAGE}.${localizerClass(result.localizerChange.to)}`);
    }
  }
  result.importsAdded = [...needed].sort();
  result.source = addImports(source, result.importsAdded);
  return result;
}

/** Points Tuning.java at a new localizer: its class in the Foresight and Tests procedures, and its tuner. */
export function updateTuningLocalizer(tuningSource: string, change: { from: string; to: string }): string {
  const fromLocalizer = localizerClass(change.from);
  const toLocalizer = localizerClass(change.to);
  const fromTuner = change.from.replace(/Config$/, "Tuner");
  const toTuner = change.to.replace(/Config$/, "Tuner");
  let source = tuningSource.replace(new RegExp(`\\bnew\\s+${fromLocalizer}\\s*\\(`, "g"), `new ${toLocalizer}(`);
  source = source.replace(new RegExp(`\\bnew\\s+${fromTuner}\\s*\\(`, "g"), `new ${toTuner}(`);
  source = replaceImport(source, `${LOCALIZER_PACKAGE}.${fromLocalizer}`, `${LOCALIZER_PACKAGE}.${toLocalizer}`);
  source = replaceImport(source, `org.firstinspires.ftc.teamcode.pedro.procedures.${fromTuner}`, `org.firstinspires.ftc.teamcode.pedro.procedures.${toTuner}`);
  return source;
}

/** Sets `TUNED` in Constants.java. */
export function setTuned(constantsSource: string, tuned: boolean): string {
  return constantsSource.replace(/(\bstatic\s+final\s+boolean\s+TUNED\s*=\s*)(true|false)(\s*;)/, `$1${tuned}$3`);
}
