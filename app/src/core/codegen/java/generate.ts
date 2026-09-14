import { BRAND } from "../../../brand";
import { resolvePath } from "../../geometry/paths";
import { toDegrees } from "../../geometry/curves";
import { hasErrors, validateProject, type Diagnostic } from "../../ir/validate";
import type {
  AtomicPath,
  AutonomousProgram,
  Binding,
  GamepadButton,
  Heading,
  PathDoc,
  Point,
  Project,
  Step,
  Subsystem,
  TeleOpProgram,
} from "../../ir/types";
import { withHeader } from "./ownership";
import { camelCase, commentText, constantCase, isQualifiedName, javaNumber, javaString, NameScope, packageSegment, pascalCase } from "./names";

/** Root package for generated code inside a robot project. */
export const GENERATED_PACKAGE = "org.firstinspires.ftc.teamcode.generated";
export const TEAMCODE_JAVA_ROOT = "TeamCode/src/main/java";
/** The Pedro Pathing constants class that quickstart projects contain. */
export const DEFAULT_CONSTANTS_CLASS = "org.firstinspires.ftc.teamcode.pedro.Constants";

/** Where generated code goes in a robot project, and which constants class it uses. */
export interface JavaTarget {
  /** Package for the generated classes. Defaults to `defaultJavaPackage(project)`. */
  javaPackage?: string;
  /** Fully qualified class with `static Follower create(HardwareMap)`. Defaults to `DEFAULT_CONSTANTS_CLASS`. */
  constantsClass?: string;
}

export function defaultJavaPackage(project: Pick<Project, "name">): string {
  return `${GENERATED_PACKAGE}.${packageSegment(project.name, "robot")}`;
}

/** The folder, relative to the robot project, that holds the classes of a package. */
export function javaPackageDirectory(javaPackage: string): string {
  return `${TEAMCODE_JAVA_ROOT}/${javaPackage.split(".").join("/")}`;
}

/** A message describing what is wrong with a target, or null when it is usable. */
export function checkJavaTarget(target: JavaTarget): string | null {
  if (target.javaPackage !== undefined && !isQualifiedName(target.javaPackage)) {
    return `"${target.javaPackage}" is not a valid Java package name. Use words separated by dots, such as org.firstinspires.ftc.teamcode.auto.`;
  }
  if (target.constantsClass !== undefined) {
    const parts = target.constantsClass.split(".");
    if (parts.length < 2 || !isQualifiedName(target.constantsClass) || !/^[A-Z]/.test(parts[parts.length - 1])) {
      return `"${target.constantsClass}" is not a fully qualified class name, such as ${DEFAULT_CONSTANTS_CLASS}.`;
    }
  }
  return null;
}

interface Constants {
  qualifiedName: string;
  simpleName: string;
}

export interface GeneratedFile {
  /** Path relative to the robot project root, with forward slashes. */
  path: string;
  content: string;
}

export type GenerationResult =
  | { ok: true; files: GeneratedFile[]; packageName: string; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

/** Classes a generated file imports or extends, which generated class names must not shadow. */
const IMPORTED_NAMES = [
  "Autonomous", "TeleOp", "OpMode", "HardwareMap", "DcMotor", "DcMotorSimple", "Servo", "CRServo",
  "Follower", "Pose", "PoseFactory", "Path", "DrivePowers", "ManualDrive", "Command", "Scheduler",
  "Constants", "Headings", "Session", "PanelsTelemetry", "TelemetryManager", "State", "RobotPose",
  "Math", "String", "Object", "System", "Override",
];

/** Field and method names in OpMode and in generated OpModes that generated members must not reuse. */
const OPMODE_MEMBERS = [
  "init", "init_loop", "start", "loop", "stop", "telemetry", "hardwareMap", "gamepad1", "gamepad2", "time",
  "report", "routine", "follower", "session", "panels", "poses", "startPose", "headingOffset", "requestOpModeStop",
  "getRuntime", "resetRuntime", "updateTelemetry", "terminateOpModeNow", "blackboard",
];

interface SubsystemNames {
  subsystem: Subsystem;
  className: string;
  field: string;
  states: Map<string, string>;
}

/**
 * Generates Java for every program and mechanism in a project. Generation is refused while the
 * project has validation errors, so generated code always reflects a coherent program.
 */
export function generateJava(project: Project, target: JavaTarget = {}): GenerationResult {
  const diagnostics = validateProject(project);
  if (hasErrors(diagnostics)) return { ok: false, diagnostics };
  const targetProblem = checkJavaTarget(target);
  if (targetProblem) {
    return { ok: false, diagnostics: [...diagnostics, { severity: "error", code: "target.invalid", message: targetProblem, location: {} }] };
  }

  const packageName = target.javaPackage ?? defaultJavaPackage(project);
  const constantsName = target.constantsClass ?? DEFAULT_CONSTANTS_CLASS;
  const constants: Constants = { qualifiedName: constantsName, simpleName: constantsName.slice(constantsName.lastIndexOf(".") + 1) };
  const classes = new NameScope([...IMPORTED_NAMES, constants.simpleName]);
  const subsystems = new Map<string, SubsystemNames>();
  for (const subsystem of project.subsystems) {
    const className = classes.claim(pascalCase(subsystem.name, "Mechanism"));
    const stateScope = new NameScope();
    const states = new Map(subsystem.states.map((state) => [state.id, stateScope.claim(constantCase(state.name, "STATE"))]));
    subsystems.set(subsystem.id, { subsystem, className, field: className.charAt(0).toLowerCase() + className.slice(1), states });
  }
  const programClasses = new Map(project.programs.map((program) => [program.id, classes.claim(pascalCase(program.name, program.kind === "autonomous" ? "Auto" : "Driver"))]));

  const directory = javaPackageDirectory(packageName);
  const files: GeneratedFile[] = [];
  const emit = (className: string, body: string) => {
    files.push({ path: `${directory}/${className}.java`, content: withHeader(body, project.name, BRAND.name) });
  };

  emit("RobotPose", robotPoseSource(packageName));
  for (const names of subsystems.values()) emit(names.className, subsystemSource(packageName, names));
  for (const program of project.programs) {
    const className = programClasses.get(program.id)!;
    if (program.kind === "autonomous") emit(className, autonomousSource(packageName, className, program, project, subsystems, constants));
    else emit(className, teleOpSource(packageName, className, program, project, subsystems, constants));
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { ok: true, files, packageName, diagnostics };
}

class Writer {
  private readonly lines: string[] = [];
  private depth = 0;

  line(text = "") {
    this.lines.push(text ? `${"    ".repeat(this.depth)}${text}` : "");
    return this;
  }

  indent(body: () => void) {
    this.depth++;
    body();
    this.depth--;
  }

  block(opening: string, body: () => void, closing = "}") {
    this.line(`${opening} {`);
    this.indent(body);
    this.line(closing);
  }

  toString() {
    return `${this.lines.join("\n")}\n`;
  }
}

function imports(writer: Writer, statics: string[], regular: string[]) {
  const unique = (items: string[]) => [...new Set(items)].sort();
  const staticImports = unique(statics);
  const thirdParty = unique(regular.filter((item) => !item.startsWith("org.firstinspires.ftc.teamcode.") && !item.startsWith(BRAND.java.package)));
  const teamCode = unique(regular.filter((item) => item.startsWith("org.firstinspires.ftc.teamcode.")));
  const library = unique(regular.filter((item) => item.startsWith(BRAND.java.package)));
  for (const group of [staticImports.map((item) => `import static ${item};`), thirdParty.map((item) => `import ${item};`), teamCode.map((item) => `import ${item};`), library.map((item) => `import ${item};`)]) {
    if (!group.length) continue;
    group.forEach((item) => writer.line(item));
    writer.line();
  }
}

function robotPoseSource(packageName: string): string {
  const w = new Writer();
  w.line(`package ${packageName};`).line();
  w.line("import com.pedropathing.math.Pose;").line();
  w.line("/** The robot's last known pose, handed from autonomous to TeleOp so field-centric driving starts aligned. */");
  w.block("public final class RobotPose", () => {
    w.line("/** Set when an autonomous stops. Null until an autonomous has run since the robot was turned on. */");
    w.line("public static Pose last = null;").line();
    w.block("private RobotPose()", () => {});
  });
  return w.toString();
}

function subsystemSource(packageName: string, names: SubsystemNames): string {
  const { subsystem, className, states } = names;
  const w = new Writer();
  const deviceScope = new NameScope(["state", "hardwareMap", "set", "command", "initialize", "isBusy", "State", className]);
  const devices = subsystem.devices.map((device) => ({ device, field: deviceScope.claim(camelCase(device.name, device.kind)) }));
  const targetMotors = new Set(subsystem.states.flatMap((state) => Object.entries(state.outputs).filter(([, output]) => output.kind === "target").map(([deviceId]) => deviceId)));
  const regular = ["com.pedropathing.ivy.Command", "com.qualcomm.robotcore.hardware.HardwareMap"];
  if (devices.some(({ device }) => device.kind === "motor")) regular.push("com.qualcomm.robotcore.hardware.DcMotor");
  if (devices.some(({ device }) => device.reversed && device.kind !== "servo")) regular.push("com.qualcomm.robotcore.hardware.DcMotorSimple");
  if (devices.some(({ device }) => device.kind === "servo")) regular.push("com.qualcomm.robotcore.hardware.Servo");
  if (devices.some(({ device }) => device.kind === "crservo")) regular.push("com.qualcomm.robotcore.hardware.CRServo");

  w.line(`package ${packageName};`).line();
  imports(w, [], regular);
  w.line(`/** The "${commentText(subsystem.name)}" mechanism. */`);
  w.block(`public class ${className}`, () => {
    w.block("public enum State", () => {
      const constants = subsystem.states.map((state) => states.get(state.id)!);
      if (constants.length) w.line(`${constants.join(", ")}`);
    });
    w.line();
    for (const { device, field } of devices) {
      const type = device.kind === "motor" ? "DcMotor" : device.kind === "servo" ? "Servo" : "CRServo";
      w.line(`private final ${type} ${field};`);
    }
    w.line("private State state = null;").line();

    w.block(`public ${className}(HardwareMap hardwareMap)`, () => {
      for (const { device, field } of devices) {
        const type = device.kind === "motor" ? "DcMotor" : device.kind === "servo" ? "Servo" : "CRServo";
        w.line(`${field} = hardwareMap.get(${type}.class, ${javaString(device.name)});`);
        if (device.reversed) {
          w.line(device.kind === "servo" ? `${field}.setDirection(Servo.Direction.REVERSE);` : `${field}.setDirection(DcMotorSimple.Direction.REVERSE);`);
        }
        if (device.kind === "motor") {
          w.line(`${field}.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);`);
          if (targetMotors.has(device.id)) w.line(`${field}.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);`);
        }
      }
    });
    w.line();

    const initial = subsystem.initialStateId ? states.get(subsystem.initialStateId) : null;
    w.line(initial ? `/** Applies the starting state, ${initial}. Call from init(). */` : "/** This mechanism has no starting state; the hardware is left as it is. */");
    w.block("public void initialize()", () => {
      if (initial) w.line(`set(State.${initial});`);
    });
    w.line();

    w.line("/** Sets the mechanism's outputs for a state. */");
    w.block("public void set(State next)", () => {
      w.line("state = next;");
      w.block("switch (next)", () => {
        for (const state of subsystem.states) {
          w.line(`case ${states.get(state.id)}:`);
          w.indent(() => {
            for (const { device, field } of devices) {
              const output = state.outputs[device.id];
              if (!output) continue;
              if (output.kind === "position") {
                w.line(`${field}.setPosition(${javaNumber(output.value)});`);
              } else if (output.kind === "power") {
                if (device.kind === "motor" && targetMotors.has(device.id)) w.line(`${field}.setMode(DcMotor.RunMode.RUN_USING_ENCODER);`);
                w.line(`${field}.setPower(${javaNumber(output.value)});`);
              } else {
                w.line(`${field}.setTargetPosition(${Math.round(output.ticks)});`);
                w.line(`${field}.setMode(DcMotor.RunMode.RUN_TO_POSITION);`);
                w.line(`${field}.setPower(${javaNumber(output.power)});`);
              }
            }
            w.line("break;");
          });
        }
      });
    });
    w.line();

    w.line("/** The most recently set state, or null before the first. */");
    w.block("public State state()", () => w.line("return state;"));
    w.line();

    const targetFields = devices.filter(({ device }) => targetMotors.has(device.id)).map(({ field }) => field);
    w.line("/** True while a motor is still moving to its target. */");
    w.block("public boolean isBusy()", () => {
      w.line(targetFields.length ? `return ${targetFields.map((field) => `${field}.isBusy()`).join(" || ")};` : "return false;");
    });
    w.line();

    w.line("/** A command that sets a state and finishes when any motor targets are reached. */");
    w.block("public Command command(State next)", () => {
      w.line("return Command.build()");
      w.indent(() => w.indent(() => {
        w.line(".setStart(() -> set(next))");
        w.line(".setDone(() -> !isBusy())");
        w.line(".requiring(this);");
      }));
    });
  });
  return w.toString();
}

interface PathNames {
  doc: PathDoc;
  method: string;
  start: string;
  end: string;
}

function headingExpression(heading: Heading): { suffix: string; usesHeadings: boolean } {
  const radians = (degrees: number) => `Math.toRadians(${javaNumber(degrees)})`;
  switch (heading.type) {
    case "linear":
      return { suffix: `.heading(Headings.linear(${radians(heading.startDeg)}, ${radians(heading.endDeg)}))`, usesHeadings: true };
    case "constant":
      return { suffix: `.constant(${radians(heading.degrees)})`, usesHeadings: false };
    case "tangential":
      return { suffix: heading.reverse ? ".reverseTangent()" : ".tangent()", usesHeadings: false };
    case "piecewise": {
      const rules = heading.segments.map((segment) => {
        const range = `${javaNumber(segment.startProgress)}, ${javaNumber(segment.endProgress)}`;
        switch (segment.type) {
          case "linear": return `.linear(${range}, ${radians(segment.startDeg)}, ${radians(segment.endDeg)})`;
          case "constant": return `.constant(${range}, ${radians(segment.degrees)})`;
          case "tangential": return `.tangent(${range}, ${segment.reverse})`;
          case "facingPoint": return `.facingPoint(${range}, ${javaNumber(segment.point.x)}, ${javaNumber(segment.point.y)})`;
        }
      });
      return { suffix: `.heading(Headings.piecewise()${rules.join("")}.build())`, usesHeadings: true };
    }
  }
}

function geometryExpression(path: AtomicPath, start: string, end: string): { code: string; usesCurve: boolean } {
  if (!path.controlPoints.length) return { code: `line(${start}, ${end})`, usesCurve: false };
  const controls = path.controlPoints.map((control) => `new Pose(${javaNumber(control.x)}, ${javaNumber(control.y)})`);
  return { code: `curve(${start}, ${controls.join(", ")}, ${end})`, usesCurve: true };
}

function autonomousSource(
  packageName: string,
  className: string,
  program: AutonomousProgram,
  project: Project,
  subsystems: Map<string, SubsystemNames>,
  constants: Constants,
): string {
  const members = new NameScope([...OPMODE_MEMBERS, className]);
  const statics = new Set<string>(["com.pedropathing.ivy.groups.Groups.sequential"]);
  const regular = new Set<string>([
    "com.pedropathing.api.PoseFactory",
    "com.pedropathing.follower.Follower",
    "com.pedropathing.ivy.Command",
    "com.pedropathing.ivy.Scheduler",
    "com.pedropathing.math.Pose",
    "com.qualcomm.robotcore.eventloop.opmode.Autonomous",
    "com.qualcomm.robotcore.eventloop.opmode.OpMode",
    constants.qualifiedName,
    `${BRAND.java.package}.Session`,
  ]);

  // Poses for the start and every path end, named after the paths.
  const poseLines: string[] = [];
  const paths: PathNames[] = [];
  const segmentEnds = new Map<string, string>();
  let startName = "startPose";
  let cursor: Point = program.start;
  poseLines.push(`private final Pose startPose = poses.of(${javaNumber(program.start.x)}, ${javaNumber(program.start.y)}, ${javaNumber(program.start.headingDeg)});`);
  program.paths.forEach((doc, index) => {
    const method = members.claim(camelCase(doc.name, `path${index + 1}`));
    const resolved = resolvePath(doc, cursor);
    if (doc.kind === "compound") {
      let segmentCursor = cursor;
      doc.segments.forEach((segment, segmentIndex) => {
        const segmentEnd = members.claim(`${method}Point${segmentIndex + 1}`);
        const heading = toDegrees(resolvePath(segment, segmentCursor).poseAt(1).heading);
        poseLines.push(`private final Pose ${segmentEnd} = poses.of(${javaNumber(segment.end.x)}, ${javaNumber(segment.end.y)}, ${javaNumber(heading)});`);
        segmentEnds.set(segment.id, segmentEnd);
        segmentCursor = segment.end;
      });
      const end = segmentEnds.get(doc.segments[doc.segments.length - 1].id)!;
      paths.push({ doc, method, start: startName, end });
      startName = end;
    } else {
      const end = members.claim(`${method}End`);
      poseLines.push(`private final Pose ${end} = poses.of(${javaNumber(doc.end.x)}, ${javaNumber(doc.end.y)}, ${javaNumber(toDegrees(resolved.poseAt(1).heading))});`);
      paths.push({ doc, method, start: startName, end });
      startName = end;
    }
    cursor = resolved.end;
  });

  const usedSubsystems = new Set<string>();
  const collect = (steps: Step[]) => steps.forEach((step) => {
    if (step.kind === "state") usedSubsystems.add(step.subsystemId);
    if (step.kind === "together" || step.kind === "race") collect(step.steps);
  });
  collect(program.routine);
  const mechanisms = project.subsystems.filter((subsystem) => usedSubsystems.has(subsystem.id) || subsystem.initialStateId).map((subsystem) => subsystems.get(subsystem.id)!);
  const mechanismFields = new Map(mechanisms.map((names) => [names.subsystem.id, members.claim(names.field)]));

  const pathBodies: string[][] = [];
  for (const { doc, start, end } of paths) {
    const body: string[] = [];
    if (doc.kind === "atomic") {
      const geometry = geometryExpression(doc, start, end);
      statics.add(geometry.usesCurve ? "com.pedropathing.api.Paths.curve" : "com.pedropathing.api.Paths.line");
      const heading = headingExpression(doc.heading);
      if (heading.usesHeadings) regular.add(`${BRAND.java.package}.Headings`);
      body.push(`return ${geometry.code}${heading.suffix};`);
    } else {
      statics.add("com.pedropathing.api.Paths.path");
      let segmentStart = start;
      const parts = doc.segments.map((segment) => {
        const segmentEnd = segmentEnds.get(segment.id)!;
        const geometry = geometryExpression(segment, segmentStart, segmentEnd);
        statics.add(geometry.usesCurve ? "com.pedropathing.api.Paths.curve" : "com.pedropathing.api.Paths.line");
        segmentStart = segmentEnd;
        if (doc.heading) return geometry.code;
        const heading = headingExpression(segment.heading);
        if (heading.usesHeadings) regular.add(`${BRAND.java.package}.Headings`);
        return `${geometry.code}${heading.suffix}`;
      });
      let suffix = "";
      if (doc.heading) {
        const heading = headingExpression(doc.heading);
        if (heading.usesHeadings) regular.add(`${BRAND.java.package}.Headings`);
        suffix = heading.suffix;
      }
      body.push("return path(");
      parts.forEach((part, index) => body.push(`        ${part}${index < parts.length - 1 ? "," : ""}`));
      body.push(`)${suffix};`);
    }
    pathBodies.push(body);
  }

  const methodByPath = new Map(paths.map((item) => [item.doc.id, item.method]));
  /** Lines for one step, indented relative to the step itself. */
  const stepLines = (step: Step): string[] | null => {
    switch (step.kind) {
      case "path":
        statics.add("com.pedropathing.ivy.pedro.PedroCommands.follow");
        return [`follow(follower, ${methodByPath.get(step.pathId)}())`];
      case "wait":
        statics.add("com.pedropathing.ivy.commands.Commands.waitMs");
        return [`waitMs(${javaNumber(step.ms)})`];
      case "state": {
        const names = subsystems.get(step.subsystemId)!;
        return [`${mechanismFields.get(step.subsystemId)}.command(${names.className}.State.${names.states.get(step.stateId)})`];
      }
      case "together":
      case "race": {
        const children = step.steps.map(stepLines).filter((child): child is string[] => child !== null);
        if (!children.length) return null;
        const group = step.kind === "together" ? "parallel" : "race";
        statics.add(`com.pedropathing.ivy.groups.Groups.${group}`);
        return [`${group}(`, ...joinWithCommas(children).map((line) => `    ${line}`), ")"];
      }
    }
  };
  const routine = joinWithCommas(program.routine.map(stepLines).filter((step): step is string[] => step !== null));

  const w = new Writer();
  w.line(`package ${packageName};`).line();
  imports(w, [...statics], [...regular, ...(paths.length ? ["com.pedropathing.paths.Path"] : [])]);
  w.line(`/** Generated from the "${commentText(program.name)}" autonomous. */`);
  const annotation = [`name = ${javaString(program.name)}`];
  if (program.group.trim()) annotation.push(`group = ${javaString(program.group)}`);
  if (program.preselectTeleOp) annotation.push(`preselectTeleOp = ${javaString(program.preselectTeleOp)}`);
  w.line(`@Autonomous(${annotation.join(", ")})`);
  w.block(`public class ${className} extends OpMode`, () => {
    w.line("private final PoseFactory poses = PoseFactory.degrees();");
    poseLines.forEach((line) => w.line(line));
    w.line();
    w.line("private Follower follower;");
    w.line("private Session session;");
    for (const names of mechanisms) w.line(`private ${names.className} ${mechanismFields.get(names.subsystem.id)};`);
    w.line();

    paths.forEach(({ doc, method }, index) => {
      if (doc.name.trim()) w.line(`/** ${commentText(doc.name)} */`);
      w.block(`private Path ${method}()`, () => pathBodies[index].forEach((line) => w.line(line)));
      w.line();
    });

    w.block("private Command routine()", () => {
      if (!routine.length) {
        w.line("return sequential();");
        return;
      }
      w.line("return sequential(");
      w.indent(() => w.indent(() => routine.forEach((line) => w.line(line))));
      w.line(");");
    });
    w.line();

    w.line("@Override");
    w.block("public void init()", () => {
      w.line("Scheduler.reset();");
      w.line(`follower = ${constants.simpleName}.create(hardwareMap);`);
      w.line("follower.setPose(startPose);");
      w.line("follower.update();");
      for (const names of mechanisms) {
        const field = mechanismFields.get(names.subsystem.id);
        w.line(`${field} = new ${names.className}(hardwareMap);`);
        w.line(`${field}.initialize();`);
      }
      w.line("session = Session.attach(this).follower(follower);");
    });
    w.line();
    w.line("@Override");
    w.block("public void init_loop()", () => {
      w.line("follower.update();");
      w.line("report();");
    });
    w.line();
    w.line("@Override");
    w.block("public void start()", () => w.line("Scheduler.schedule(routine());"));
    w.line();
    w.line("@Override");
    w.block("public void loop()", () => {
      w.line("follower.update();");
      w.line("Scheduler.execute();");
      w.line("report();");
    });
    w.line();
    w.line("@Override");
    w.block("public void stop()", () => {
      w.line("Scheduler.reset();");
      w.block("if (follower != null)", () => {
        w.line("RobotPose.last = follower.pose();");
        w.line("follower.stop();");
      });
    });
    w.line();
    w.block("private void report()", () => {
      w.line("Pose pose = follower.pose();");
      w.line("telemetry.addData(\"x (in)\", \"%.1f\", pose.x());");
      w.line("telemetry.addData(\"y (in)\", \"%.1f\", pose.y());");
      w.line("telemetry.addData(\"heading (deg)\", \"%.1f\", Math.toDegrees(pose.heading()));");
      for (const names of mechanisms) {
        w.line(`telemetry.addData(${javaString(names.subsystem.name)}, ${mechanismFields.get(names.subsystem.id)}.state());`);
      }
      w.line("session.update();");
    });
  });
  return w.toString();
}

/** Flattens step line groups, adding a comma after each group except the last. */
function joinWithCommas(groups: string[][]): string[] {
  return groups.flatMap((lines, index) => index < groups.length - 1
    ? [...lines.slice(0, -1), `${lines[lines.length - 1]},`]
    : lines);
}

const EDGE_METHOD: Record<GamepadButton, string> = {
  a: "a", b: "b", x: "x", y: "y",
  dpad_up: "dpadUp", dpad_down: "dpadDown", dpad_left: "dpadLeft", dpad_right: "dpadRight",
  left_bumper: "leftBumper", right_bumper: "rightBumper",
  left_stick_button: "leftStickButton", right_stick_button: "rightStickButton",
  back: "back", start: "start", guide: "guide",
};

function teleOpSource(
  packageName: string,
  className: string,
  program: TeleOpProgram,
  project: Project,
  subsystems: Map<string, SubsystemNames>,
  constants: Constants,
): string {
  const members = new NameScope([...OPMODE_MEMBERS, className, "FIELD_CENTRIC", "SLOW_MODE_SCALE"]);
  const used = new Set(program.bindings.map((binding) => binding.action.subsystemId));
  const mechanisms = project.subsystems.filter((subsystem) => used.has(subsystem.id) || subsystem.initialStateId).map((subsystem) => subsystems.get(subsystem.id)!);
  const fields = new Map(mechanisms.map((names) => [names.subsystem.id, members.claim(names.field)]));
  const toggles = new Map(program.bindings.filter((binding) => binding.action.kind === "toggle").map((binding) => [binding.id, members.claim(`${fields.get(binding.action.subsystemId)}Toggle${EDGE_METHOD[binding.button].charAt(0).toUpperCase()}${EDGE_METHOD[binding.button].slice(1)}`)]));

  const regular = [
    "com.pedropathing.api.PoseFactory",
    "com.pedropathing.drivetrain.DrivePowers",
    "com.pedropathing.follower.Follower",
    "com.qualcomm.robotcore.eventloop.opmode.OpMode",
    "com.qualcomm.robotcore.eventloop.opmode.TeleOp",
    constants.qualifiedName,
    `${BRAND.java.package}.Session`,
  ];
  if (program.drive.fieldCentric) regular.push("com.pedropathing.follower.ManualDrive");

  const stateRef = (subsystemId: string, stateId: string) => {
    const names = subsystems.get(subsystemId)!;
    return `${names.className}.State.${names.states.get(stateId)}`;
  };
  const bindingLines = (binding: Binding): string[] => {
    const gamepad = `gamepad${binding.gamepad}`;
    const edge = EDGE_METHOD[binding.button];
    const field = fields.get(binding.action.subsystemId)!;
    switch (binding.action.kind) {
      case "state":
        return [`if (${gamepad}.${edge}WasPressed()) ${field}.set(${stateRef(binding.action.subsystemId, binding.action.stateId)});`];
      case "toggle": {
        const toggle = toggles.get(binding.id)!;
        return [
          `if (${gamepad}.${edge}WasPressed()) {`,
          `    ${toggle} = !${toggle};`,
          `    ${field}.set(${toggle} ? ${stateRef(binding.action.subsystemId, binding.action.firstStateId)} : ${stateRef(binding.action.subsystemId, binding.action.secondStateId)});`,
          "}",
        ];
      }
      case "hold":
        return [
          `if (${gamepad}.${edge}WasPressed()) ${field}.set(${stateRef(binding.action.subsystemId, binding.action.heldStateId)});`,
          `if (${gamepad}.${edge}WasReleased()) ${field}.set(${stateRef(binding.action.subsystemId, binding.action.releasedStateId)});`,
        ];
    }
  };

  const w = new Writer();
  w.line(`package ${packageName};`).line();
  imports(w, [], regular);
  w.line(`/** Generated from the "${commentText(program.name)}" TeleOp. */`);
  const annotation = [`name = ${javaString(program.name)}`];
  if (program.group.trim()) annotation.push(`group = ${javaString(program.group)}`);
  w.line(`@TeleOp(${annotation.join(", ")})`);
  w.block(`public class ${className} extends OpMode`, () => {
    w.line(`private static final boolean FIELD_CENTRIC = ${program.drive.fieldCentric};`);
    w.line(`private static final double SLOW_MODE_SCALE = ${javaNumber(program.drive.slowModeScale)};`);
    w.line();
    w.line("private final PoseFactory poses = PoseFactory.degrees();");
    w.line("private Follower follower;");
    w.line("private Session session;");
    for (const names of mechanisms) w.line(`private ${names.className} ${fields.get(names.subsystem.id)};`);
    for (const toggle of toggles.values()) w.line(`private boolean ${toggle} = false;`);
    w.line("private double headingOffset = 0;");
    w.line();

    w.line("@Override");
    w.block("public void init()", () => {
      w.line(`follower = ${constants.simpleName}.create(hardwareMap);`);
      w.line(`follower.setPose(RobotPose.last != null ? RobotPose.last : poses.of(${javaNumber(program.start.x)}, ${javaNumber(program.start.y)}, ${javaNumber(program.start.headingDeg)}));`);
      w.line("follower.update();");
      for (const names of mechanisms) {
        const field = fields.get(names.subsystem.id);
        w.line(`${field} = new ${names.className}(hardwareMap);`);
        w.line(`${field}.initialize();`);
      }
      w.line("session = Session.attach(this).follower(follower);");
    });
    w.line();
    w.line("@Override");
    w.block("public void init_loop()", () => {
      w.line("follower.update();");
      w.line("report();");
    });
    w.line();
    w.line("@Override");
    w.block("public void loop()", () => {
      for (const binding of program.bindings) bindingLines(binding).forEach((line) => w.line(line));
      if (program.bindings.length) w.line();
      if (program.drive.resetHeadingButton) {
        w.line(`if (gamepad1.${EDGE_METHOD[program.drive.resetHeadingButton]}WasPressed()) headingOffset = -follower.pose().heading();`);
      }
      w.line(program.drive.slowModeButton ? `double scale = gamepad1.${program.drive.slowModeButton} ? SLOW_MODE_SCALE : 1.0;` : "double scale = 1.0;");
      w.line("DrivePowers powers = new DrivePowers(");
      w.indent(() => w.indent(() => {
        w.line("-gamepad1.left_stick_y * scale,");
        w.line("-gamepad1.left_stick_x * scale,");
        w.line("-gamepad1.right_stick_x * scale);");
      }));
      if (program.drive.fieldCentric) {
        w.line("if (FIELD_CENTRIC) powers = ManualDrive.fieldCentric(powers, follower.pose().heading(), headingOffset);");
      }
      w.line("follower.manual(powers);");
      w.line("follower.update();");
      w.line("report();");
    });
    w.line();
    w.line("@Override");
    w.block("public void stop()", () => {
      w.block("if (follower != null)", () => w.line("follower.stop();"));
    });
    w.line();
    w.block("private void report()", () => {
      w.line("telemetry.addData(\"drive\", FIELD_CENTRIC ? \"field-centric\" : \"robot-centric\");");
      w.line("telemetry.addData(\"heading (deg)\", \"%.1f\", Math.toDegrees(follower.pose().heading()));");
      for (const names of mechanisms) {
        w.line(`telemetry.addData(${javaString(names.subsystem.name)}, ${fields.get(names.subsystem.id)}.state());`);
      }
      w.line("session.update();");
    });
  });
  return w.toString();
}
