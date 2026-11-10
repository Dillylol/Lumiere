/**
 * Framework-free program logic shared by every part of the app. Nothing here imports React or Tauri,
 * so it runs in the web app, the desktop app, and tests alike. See README.md in this folder.
 */
export * from "./ir/types";
export { parseProject, safeParseProject, describeProjectError, projectSchema, ROBOT_LIMITS } from "./ir/schema";
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
export { validateProject, hasErrors, buttonLabel, describeLocation, actionNumber, AUTONOMOUS_PERIOD_MS, type Diagnostic, type DiagnosticLocation, type Severity } from "./ir/validate";
export { isVersion1Project, migrateVersion1, migrateVersion2, type Migration } from "./ir/migrate";
export { physicalRobot, type PhysicalRobot } from "./ir/robot";
export { DRIVE_ROLES, ENCODER_ROLES, localizerLabel, pedroDevices, pedroMismatches, pedroRoleLabel, pedroRoleType, type OwnedDevice } from "./ir/pedro";

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

export {
  estimateRoutine,
  estimateRoutine as buildTimeline,
  profilePath,
  directional,
  SETTLE_MS,
  TARGET_STATE_ESTIMATE_MS,
  type MotionRobot,
  type PathProfile,
  type RoutineEstimate,
  type RoutineEstimate as PreviewTimeline,
  type TimelineEntry,
} from "./motion/estimate";
export { exportVisualizer, importVisualizer, VISUALIZER_VERSION, type ImportedPaths } from "./pp/visualizer";
export {
  addPath,
  addPenPath,
  deletePath,
  endPose,
  insertControlPoint,
  movePath,
  movePoint,
  pointAt,
  removeControlPoint,
  setHeading,
  setWaitAfter,
  snapPoint,
  updatePath,
  waitAfter,
  type PointRef,
} from "./pathing/edit";
export { MIRROR_AXIS, mirrorAngle, mirrorHeading, mirrorProgram } from "./pathing/mirror";
export { clampToFloor, FIELD_FLOOR_INCHES, FIELD_IMAGE_OVERHANG, GRID_SIZES, gridLines, snapToGrid, TILE_INCHES } from "./pathing/field";
export { fitStroke, PEN_MAX_VERTICES } from "./pathing/pen";

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
export { describeReport, readDeviceReports, readMechanisms, type DeviceReport, type MechanismReading } from "./protocol/devices";
export { findRobot, StreamClient, type ConnectionStatus, type SocketFactory, type SocketLike, type StreamClientOptions } from "./protocol/client";

export {
  checkJavaTarget,
  DEFAULT_CONSTANTS_CLASS,
  defaultJavaPackage,
  javaPackageDirectory,
  LIVE_CLASS,
  type JavaTarget,
  type LiveTarget,
} from "./codegen/java/generate";
export {
  buildLiveProgram,
  LIVE_DEFAULT_POWER_CAP,
  LIVE_FORMAT,
  LIVE_OPMODE_NAME,
  readLiveReport,
  type LiveMechanism,
  type LivePath,
  type LivePose,
  type LiveProgram,
  type LiveReport,
  type LiveSegment,
  type LiveStep,
} from "./live/program";
export { isPairingHash, newPairingSecret, pairingHash } from "./live/pairing";
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
export { readPedroConstants, syncRobotProfile, type PedroConstants } from "./sdk/pedroConstants";
export { SIZING_CUBE_INCHES } from "./ir/validate";
