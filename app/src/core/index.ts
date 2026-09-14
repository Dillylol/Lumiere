/**
 * Framework-free program logic shared by every part of the app. Nothing here imports React or Tauri,
 * so it runs in the web app, the desktop app, and tests alike. See README.md in this folder.
 */
export * from "./ir/types";
export { parseProject, safeParseProject, projectSchema } from "./ir/schema";
export {
  createAutonomous,
  createDevice,
  createLine,
  createProject,
  createState,
  createSubsystem,
  createTeleOp,
  DEFAULT_ROBOT,
  duplicateProject,
  newId,
  pathColor,
} from "./ir/create";
export { validateProject, hasErrors, buttonLabel, AUTONOMOUS_PERIOD_MS, type Diagnostic, type DiagnosticLocation, type Severity } from "./ir/validate";
export { isVersion1Project, migrateVersion1, type Migration } from "./ir/migrate";

export {
  angleError,
  BezierCurve,
  completion,
  CompoundCurve,
  curveBetween,
  LineCurve,
  normalizeAngle,
  normalizeSignedAngle,
  tangentAngle,
  toDegrees,
  toRadians,
  type Curve,
} from "./geometry/curves";
export { headingAt } from "./geometry/headings";
export { resolvePath, resolveProgramPaths, samplePath, type Pose, type ResolvedPath } from "./geometry/paths";

export { buildTimeline, travelTimeMs, type PreviewTimeline, type TimelineEntry } from "./preview/timeline";
export { exportVisualizer, importVisualizer, VISUALIZER_VERSION, type ImportedPaths } from "./pp/visualizer";

export { generateJava, GENERATED_PACKAGE, TEAMCODE_JAVA_ROOT, type GeneratedFile, type GenerationResult } from "./codegen/java/generate";
export { ownershipOf, planWrites, type Ownership, type WritePlanEntry } from "./codegen/java/ownership";
export {
  parseBuildOutput,
  relativeToProject,
  type BuildOutcome,
  type BuildProblem,
  type BuildSummary,
  type ProblemSeverity,
} from "./java/buildOutput";
export { findOpModes, type OpModeDeclaration, type OpModeFlavor } from "./java/opModes";
export { importsOf, maskJava, packageOf } from "./java/source";
export {
  applyTunerOutput,
  parseTunerOutput,
  setTuned,
  TUNER_IMPORTS,
  updateTuningLocalizer,
  type TunerApplyResult,
  type TunerDeclaration,
} from "./java/tuning";
export { addImports } from "./java/source";
export { javaCompletions, type CompletionItem, type CompletionKind, type CompletionResult } from "./javaHints/completions";
export { CLASSES as JAVA_CLASSES, HINTS as JAVA_HINTS, SNIPPETS as JAVA_SNIPPETS, type JavaHint, type JavaSnippet } from "./javaHints/hints";

export * from "./protocol/messages";
export { findRobot, StreamClient, type ConnectionStatus, type StreamClientOptions } from "./protocol/client";

export {
  checkJavaTarget,
  DEFAULT_CONSTANTS_CLASS,
  defaultJavaPackage,
  javaPackageDirectory,
  type JavaTarget,
} from "./codegen/java/generate";
export {
  EXPECTED_SDK_VERSION,
  INSPECTED_FILES,
  INSPECTED_JAVA_ROOT,
  inspectFtcProject,
  type ConstantsClass,
  type FtcProjectInspection,
  type FtcProjectSnapshot,
  type LibraryStatus,
} from "./sdk/ftcProject";
export {
  defaultDeploySettings,
  describeDeploy,
  planDeploy,
  selectPrograms,
  type DeployPlan,
  type DeployPlanResult,
  type DeployRemoval,
  type DeploySettings,
} from "./sdk/deploy";
