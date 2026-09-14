/**
 * Hand-written completion hints for the classes FTC robot code uses most: the FTC SDK, Pedro Pathing,
 * Ivy, Panels, and this app's robot library. Summaries are our own words; links point to the official
 * documentation. Every entry is checked against the real libraries by JavaHintsTest in the quickstart CI
 * job (fixtures/java-hints.json is generated from this file).
 */
import { BRAND } from "../../brand";

export type HintKind = "method" | "staticMethod" | "field" | "staticField";

export interface Parameter {
  /** Java type as written in source, e.g. `double`, `Command...`, `Class<T>`. */
  type: string;
  name: string;
}

export interface JavaHint {
  /** Fully qualified class that declares or inherits the member. */
  owner: string;
  name: string;
  kind: HintKind;
  params: Parameter[];
  /** Simple type name; a single capital letter means a generic type. */
  returns: string;
  summary: string;
  docs?: string;
}

const FTC_DOCS = "https://ftc-docs.firstinspires.org/en/latest";
const FTC_OPMODES = `${FTC_DOCS}/programming_resources/android_studio_java/opmode/opmode.html`;
const PEDRO_DOCS = "https://pedropathing.com/docs/pathing";
const IVY_DOCS = "https://pedropathing.com/docs/ivy";
const PANELS_DOCS = "https://panels.bylazar.com";

export const CLASSES: Record<string, string> = {
  OpMode: "com.qualcomm.robotcore.eventloop.opmode.OpMode",
  LinearOpMode: "com.qualcomm.robotcore.eventloop.opmode.LinearOpMode",
  Autonomous: "com.qualcomm.robotcore.eventloop.opmode.Autonomous",
  TeleOp: "com.qualcomm.robotcore.eventloop.opmode.TeleOp",
  Disabled: "com.qualcomm.robotcore.eventloop.opmode.Disabled",
  HardwareMap: "com.qualcomm.robotcore.hardware.HardwareMap",
  DcMotorSimple: "com.qualcomm.robotcore.hardware.DcMotorSimple",
  DcMotor: "com.qualcomm.robotcore.hardware.DcMotor",
  DcMotorEx: "com.qualcomm.robotcore.hardware.DcMotorEx",
  Servo: "com.qualcomm.robotcore.hardware.Servo",
  CRServo: "com.qualcomm.robotcore.hardware.CRServo",
  IMU: "com.qualcomm.robotcore.hardware.IMU",
  VoltageSensor: "com.qualcomm.robotcore.hardware.VoltageSensor",
  TouchSensor: "com.qualcomm.robotcore.hardware.TouchSensor",
  DistanceSensor: "com.qualcomm.robotcore.hardware.DistanceSensor",
  Gamepad: "com.qualcomm.robotcore.hardware.Gamepad",
  ElapsedTime: "com.qualcomm.robotcore.util.ElapsedTime",
  Telemetry: "org.firstinspires.ftc.robotcore.external.Telemetry",
  YawPitchRollAngles: "org.firstinspires.ftc.robotcore.external.navigation.YawPitchRollAngles",
  AngleUnit: "org.firstinspires.ftc.robotcore.external.navigation.AngleUnit",
  DistanceUnit: "org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit",
  CurrentUnit: "org.firstinspires.ftc.robotcore.external.navigation.CurrentUnit",
  Follower: "com.pedropathing.follower.Follower",
  ManualDrive: "com.pedropathing.follower.ManualDrive",
  DrivePowers: "com.pedropathing.drivetrain.DrivePowers",
  Path: "com.pedropathing.paths.Path",
  Paths: "com.pedropathing.api.Paths",
  Pose: "com.pedropathing.math.Pose",
  PoseFactory: "com.pedropathing.api.PoseFactory",
  Command: "com.pedropathing.ivy.Command",
  CommandBuilder: "com.pedropathing.ivy.CommandBuilder",
  Groups: "com.pedropathing.ivy.groups.Groups",
  Commands: "com.pedropathing.ivy.commands.Commands",
  Scheduler: "com.pedropathing.ivy.Scheduler",
  PedroCommands: "com.pedropathing.ivy.pedro.PedroCommands",
  PanelsTelemetry: "com.bylazar.telemetry.PanelsTelemetry",
  TelemetryManager: "com.bylazar.telemetry.TelemetryManager",
  PanelsField: "com.bylazar.field.PanelsField",
  FieldManager: "com.bylazar.field.FieldManager",
  Session: `${BRAND.java.package}.Session`,
  Headings: `${BRAND.java.package}.Headings`,
  Constants: "org.firstinspires.ftc.teamcode.pedro.Constants",
};

const p = (...pairs: string[]): Parameter[] =>
  pairs.map((pair) => {
    const at = pair.lastIndexOf(" ");
    return { type: pair.slice(0, at), name: pair.slice(at + 1) };
  });

function members(owner: keyof typeof CLASSES, kind: HintKind, docs: string | undefined, entries: [string, Parameter[], string, string][]): JavaHint[] {
  return entries.map(([name, params, returns, summary]) => ({ owner: CLASSES[owner], name, kind, params, returns, summary, ...(docs ? { docs } : {}) }));
}

const gamepadButtons = ["a", "b", "x", "y", "left_bumper", "right_bumper", "dpad_up", "dpad_down", "dpad_left", "dpad_right", "back", "start"];
const pressedMethod = (button: string) => `${button.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())}WasPressed`;

export const HINTS: JavaHint[] = [
  ...members("OpMode", "field", FTC_OPMODES, [
    ["hardwareMap", [], "HardwareMap", "Devices in the active Driver Station configuration."],
    ["telemetry", [], "Telemetry", "Text shown on the Driver Station screen."],
    ["gamepad1", [], "Gamepad", "The first driver's gamepad."],
    ["gamepad2", [], "Gamepad", "The second driver's gamepad."],
  ]),
  ...members("OpMode", "method", undefined, [
    ["init", [], "void", "Runs once when INIT is pressed."],
    ["init_loop", [], "void", "Runs repeatedly after INIT until START is pressed."],
    ["start", [], "void", "Runs once when START is pressed."],
    ["loop", [], "void", "Runs repeatedly after START until the OpMode stops."],
    ["stop", [], "void", "Runs once when the OpMode stops."],
    ["getRuntime", [], "double", "Seconds on the OpMode's timer. See resetRuntime()."],
    ["resetRuntime", [], "void", "Restarts the timer that getRuntime() reads."],
    ["requestOpModeStop", [], "void", "Asks the SDK to stop this OpMode, as if STOP were pressed."],
  ]),
  ...members("LinearOpMode", "method", undefined, [
    ["runOpMode", [], "void", "The whole program of a LinearOpMode, from INIT to the end."],
    ["waitForStart", [], "void", "Waits until START is pressed or the OpMode is stopped."],
    ["opModeIsActive", [], "boolean", "True after START while the OpMode should keep running. Use it as the loop condition."],
    ["opModeInInit", [], "boolean", "True after INIT until START or STOP is pressed."],
    ["isStopRequested", [], "boolean", "True once the OpMode has been asked to stop."],
    ["sleep", p("long milliseconds"), "void", "Pauses this OpMode for the given time."],
    ["idle", [], "void", "Lets other threads run; useful inside tight loops."],
  ]),
  ...members("HardwareMap", "method", `${FTC_DOCS}/programming_resources/android_studio_java/config/config.html`, [
    ["get", p("Class<T> type", "String name"), "T", "The configured device with this name, as the given type, such as DcMotorEx.class."],
    ["tryGet", p("Class<T> type", "String name"), "T", "Like get, but returns null when no device has this name."],
  ]),
  ...members("DcMotorSimple", "method", `${FTC_DOCS}/control_hard_compon/rc_components/motors/motors.html`, [
    ["setPower", p("double power"), "void", "Power from -1 to 1."],
    ["getPower", [], "double", "The last power set."],
    ["setDirection", p("DcMotorSimple.Direction direction"), "void", "FORWARD or REVERSE. REVERSE flips the sign of power."],
  ]),
  ...members("DcMotor", "method", undefined, [
    ["setMode", p("DcMotor.RunMode mode"), "void", "RUN_WITHOUT_ENCODER, RUN_USING_ENCODER, RUN_TO_POSITION, or STOP_AND_RESET_ENCODER."],
    ["setTargetPosition", p("int position"), "void", "Target in encoder ticks for RUN_TO_POSITION. Set it before switching to that mode."],
    ["getCurrentPosition", [], "int", "Encoder position in ticks."],
    ["isBusy", [], "boolean", "True while RUN_TO_POSITION is still moving toward its target."],
    ["setZeroPowerBehavior", p("DcMotor.ZeroPowerBehavior behavior"), "void", "BRAKE or FLOAT when power is 0."],
  ]),
  ...members("DcMotorEx", "method", undefined, [
    ["setVelocity", p("double ticksPerSecond"), "void", "Target velocity in encoder ticks per second. Needs an encoder."],
    ["getVelocity", [], "double", "Measured velocity in encoder ticks per second."],
    ["getCurrent", p("CurrentUnit unit"), "double", "Current drawn by the motor."],
  ]),
  ...members("Servo", "method", `${FTC_DOCS}/control_hard_compon/rc_components/servos/servos.html`, [
    ["setPosition", p("double position"), "void", "Position from 0 to 1."],
    ["getPosition", [], "double", "The last position set. Standard servos do not report where they actually are."],
    ["setDirection", p("Servo.Direction direction"), "void", "FORWARD or REVERSE. REVERSE mirrors positions."],
    ["scaleRange", p("double min", "double max"), "void", "Maps positions 0 to 1 onto a narrower range of the servo's travel."],
  ]),
  ...members("CRServo", "method", undefined, [
    ["setPower", p("double power"), "void", "Speed from -1 to 1 for a continuous-rotation servo."],
  ]),
  ...members("IMU", "method", `${FTC_DOCS}/programming_resources/imu/imu.html`, [
    ["initialize", p("IMU.Parameters parameters"), "boolean", "Sets how the hub is mounted on the robot. Call once during init."],
    ["resetYaw", [], "void", "Makes the current heading zero."],
    ["getRobotYawPitchRollAngles", [], "YawPitchRollAngles", "The robot's current orientation."],
  ]),
  ...members("YawPitchRollAngles", "method", undefined, [
    ["getYaw", p("AngleUnit unit"), "double", "Heading around the vertical axis; counterclockwise is positive."],
  ]),
  ...members("VoltageSensor", "method", undefined, [["getVoltage", [], "double", "Battery voltage in volts."]]),
  ...members("TouchSensor", "method", undefined, [["isPressed", [], "boolean", "True while the sensor is pressed."]]),
  ...members("DistanceSensor", "method", undefined, [["getDistance", p("DistanceUnit unit"), "double", "Measured distance in the given unit."]]),
  ...members("Telemetry", "method", FTC_OPMODES, [
    ["addData", p("String caption", "Object value"), "Telemetry.Item", "Adds a \"caption: value\" line to the next update()."],
    ["addLine", p("String text"), "Telemetry.Line", "Adds a line of text to the next update()."],
    ["update", [], "boolean", "Sends the lines added since the last update to the Driver Station."],
    ["clear", [], "void", "Removes lines that have not been sent yet."],
  ]),
  ...members("Gamepad", "field", FTC_OPMODES, [
    ["left_stick_x", [], "float", "Left stick sideways: -1 left to 1 right."],
    ["left_stick_y", [], "float", "Left stick up and down: pushing up gives negative values."],
    ["right_stick_x", [], "float", "Right stick sideways: -1 left to 1 right."],
    ["right_stick_y", [], "float", "Right stick up and down: pushing up gives negative values."],
    ["left_trigger", [], "float", "Left trigger from 0 to 1."],
    ["right_trigger", [], "float", "Right trigger from 0 to 1."],
    ...gamepadButtons.map((button): [string, Parameter[], string, string] => [button, [], "boolean", `True while ${button.replace(/_/g, " ")} is held.`]),
  ]),
  ...members("Gamepad", "method", undefined, [
    ...gamepadButtons.map((button): [string, Parameter[], string, string] => [pressedMethod(button), [], "boolean", `True once for each press of ${button.replace(/_/g, " ")} since this method was last called.`]),
    ["rumble", p("int milliseconds"), "void", "Vibrates a gamepad that supports rumble."],
  ]),
  ...members("ElapsedTime", "method", undefined, [
    ["reset", [], "void", "Restarts the timer."],
    ["seconds", [], "double", "Seconds since the timer started or was reset."],
    ["milliseconds", [], "double", "Milliseconds since the timer started or was reset."],
  ]),

  ...members("Follower", "method", PEDRO_DOCS, [
    ["update", [], "void", "Reads the localizer and drives toward the current goal. Call it every loop."],
    ["follow", p("Path path"), "void", "Starts following a path."],
    ["hold", p("Pose pose"), "void", "Holds the robot at a pose."],
    ["manual", p("DrivePowers powers"), "void", "Drives with the given forward, strafe, and turn powers, as in TeleOp."],
    ["setPose", p("Pose pose"), "void", "Sets where the localizer thinks the robot is, usually the start pose."],
    ["pose", [], "Pose", "The current estimated pose in field inches and radians."],
    ["isBusy", [], "boolean", "True while the follower is still working on its goal."],
    ["mode", [], "Follower.Mode", "What the follower is doing: FOLLOW, HOLD, MANUAL, or IDLE."],
  ]),
  ...members("ManualDrive", "staticMethod", PEDRO_DOCS, [
    ["fieldCentric", p("DrivePowers powers", "double headingRadians", "double offsetRadians"), "DrivePowers", "Turns driver-relative powers into robot-relative ones using the robot's heading."],
  ]),
  ...members("DrivePowers", "method", undefined, [
    ["forward", [], "double", "Forward power."],
    ["strafe", [], "double", "Sideways power; positive is to the robot's left."],
    ["turn", [], "double", "Turning power; positive is counterclockwise."],
  ]),
  ...members("Paths", "staticMethod", PEDRO_DOCS, [
    ["line", p("Pose start", "Pose end"), "Path", "A straight path from start to end."],
    ["curve", p("Pose... points"), "Path", "A Bézier curve: the first and last points are the ends, the points between are control points."],
    ["path", p("Path... paths"), "Path", "Joins paths into one continuous path."],
  ]),
  ...members("Path", "method", PEDRO_DOCS, [
    ["linear", p("Pose start", "Pose end"), "Path", "Turns from the start heading to the end heading. In Pedro Pathing 3.0.0 this runs backwards on straight lines; use heading(Headings.linear(start, end))."],
    ["constant", p("double radians"), "Path", "Keeps one heading for the whole path."],
    ["tangent", [], "Path", "Faces the direction of travel."],
    ["reverseTangent", [], "Path", "Faces away from the direction of travel."],
    ["facingPoint", p("Pose point"), "Path", "Keeps the robot facing a point on the field."],
    ["heading", p("Interpolator interpolator"), "Path", "Uses a custom heading, such as Headings.linear(start, end)."],
    ["endPose", [], "Pose", "The pose at the end of the path."],
  ]),
  ...members("Pose", "method", `${PEDRO_DOCS}/reference/coordinates`, [
    ["x", [], "double", "Inches from the left edge of the field."],
    ["y", [], "double", "Inches from the bottom edge of the field."],
    ["heading", [], "double", "Heading in radians; 0 points along +x and counterclockwise is positive."],
    ["distance", p("Pose other"), "double", "Straight-line distance to another pose, in inches."],
    ["withHeading", p("double radians"), "Pose", "A copy of this pose with a different heading."],
  ]),
  ...members("PoseFactory", "staticMethod", `${PEDRO_DOCS}/reference/coordinates`, [
    ["degrees", [], "PoseFactory", "Creates poses whose headings are given in degrees."],
    ["radians", [], "PoseFactory", "Creates poses whose headings are given in radians."],
  ]),
  ...members("PoseFactory", "method", undefined, [
    ["of", p("double x", "double y", "double heading"), "Pose", "A pose at x and y inches with the given heading."],
  ]),

  ...members("Groups", "staticMethod", IVY_DOCS, [
    ["sequential", p("Command... commands"), "CommandBuilder", "Runs the commands one after another."],
    ["parallel", p("Command... commands"), "CommandBuilder", "Runs the commands at the same time until all of them finish."],
    ["race", p("Command... commands"), "CommandBuilder", "Runs the commands at the same time until any one finishes."],
    ["deadline", p("Command deadline", "Command... others"), "CommandBuilder", "Runs the commands at the same time until the first one finishes."],
  ]),
  ...members("Commands", "staticMethod", IVY_DOCS, [
    ["waitMs", p("double milliseconds"), "CommandBuilder", "Waits for the given time."],
    ["waitUntil", p("BooleanSupplier condition"), "CommandBuilder", "Waits until the condition is true."],
    ["instant", p("Runnable action"), "CommandBuilder", "Runs the code once and finishes."],
    ["conditional", p("BooleanSupplier condition", "Command whenTrue", "Command whenFalse"), "CommandBuilder", "Chooses a command when it starts."],
  ]),
  ...members("Scheduler", "staticMethod", IVY_DOCS, [
    ["schedule", p("Command command"), "void", "Starts a command."],
    ["execute", [], "void", "Runs the scheduled commands. Call it every loop."],
    ["reset", [], "void", "Removes every command. Call it in init so nothing carries over from the last OpMode."],
    ["cancel", p("Command command"), "void", "Stops a command."],
  ]),
  ...members("PedroCommands", "staticMethod", IVY_DOCS, [
    ["follow", p("Follower follower", "Path path"), "CommandBuilder", "Follows a path and finishes when the follower is done."],
    ["hold", p("Follower follower", "Pose pose"), "CommandBuilder", "Holds the robot at a pose."],
  ]),
  ...members("Command", "method", IVY_DOCS, [
    ["then", p("Command... next"), "CommandBuilder", "Runs the next commands after this one."],
    ["with", p("Command... others"), "CommandBuilder", "Runs other commands alongside this one."],
    ["until", p("BooleanSupplier condition"), "CommandBuilder", "Ends this command early when the condition becomes true."],
  ]),

  ...members("PanelsTelemetry", "staticField", PANELS_DOCS, [["INSTANCE", [], "PanelsTelemetry", "The Panels telemetry plugin."]]),
  ...members("PanelsTelemetry", "method", undefined, [["getTelemetry", [], "TelemetryManager", "Telemetry shown on the Panels dashboard at http://192.168.43.1:8001."]]),
  ...members("TelemetryManager", "method", PANELS_DOCS, [
    ["addData", p("String caption", "Object value"), "void", "Adds a \"caption: value\" line."],
    ["addLine", p("String text"), "void", "Adds a line of text."],
    ["update", p("Telemetry telemetry"), "void", "Sends the lines to Panels and to the Driver Station."],
  ]),
  ...members("PanelsField", "staticField", PANELS_DOCS, [["INSTANCE", [], "PanelsField", "The Panels field plugin."]]),
  ...members("PanelsField", "method", undefined, [["getField", [], "FieldManager", "Draws shapes on the Panels field view."]]),

  ...members("Session", "staticMethod", undefined, [
    ["attach", p("OpMode opMode"), "Session", `Sends this OpMode's pose, path, and data to ${BRAND.name}. Safe when the app is not connected.`],
  ]),
  ...members("Session", "method", undefined, [
    ["follower", p("Follower follower"), "Session", "Includes the follower's pose, target, and path."],
    ["data", p("String name", "Object value"), "Session", `Adds a value shown in ${BRAND.name}.`],
    ["update", [], "void", "Sends the latest data, at most 20 times a second. Call it every loop."],
  ]),
  ...members("Headings", "staticMethod", undefined, [
    ["linear", p("Pose start", "Pose end"), "Interpolator", "Turns from the start heading to the end heading on any path type. Use with path.heading(...)."],
    ["linearUntil", p("Pose start", "Pose end", "double endCompletion"), "Interpolator", "Like linear, but finishes turning at the given fraction of the path."],
  ]),
  ...members("Constants", "staticMethod", undefined, [
    ["create", p("HardwareMap hardwareMap"), "Follower", "Creates the follower with this robot's drivetrain, localizer, and tuning."],
  ]),
];

/** Snippets offered where a statement or member can start. `$1`, `$2` and `$0` are tab stops. */
export interface JavaSnippet {
  label: string;
  summary: string;
  body: string;
  imports: string[];
}

export const SNIPPETS: JavaSnippet[] = [
  {
    label: "hardwareMap.get",
    summary: "Get a configured device",
    body: 'hardwareMap.get(${1:DcMotorEx}.class, "${2:name}")$0',
    imports: [],
  },
  {
    label: "Pedro autonomous",
    summary: "Iterative autonomous OpMode that follows a path with Pedro Pathing and Ivy",
    body: [
      '@Autonomous(name = "${1:My Auto}")',
      "public class ${2:MyAuto} extends OpMode {",
      "    private Follower follower;",
      "    private Session session;",
      "",
      "    @Override",
      "    public void init() {",
      "        Scheduler.reset();",
      "        follower = Constants.create(hardwareMap);",
      "        Pose start = PoseFactory.degrees().of(${3:9}, ${4:72}, ${5:0});",
      "        follower.setPose(start);",
      "        session = Session.attach(this).follower(follower);",
      "    }",
      "",
      "    @Override",
      "    public void start() {",
      "        Pose end = PoseFactory.degrees().of(${6:36}, ${7:72}, ${8:0});",
      "        Scheduler.schedule(Groups.sequential(",
      "                PedroCommands.follow(follower, Paths.line(follower.pose(), end).heading(Headings.linear(follower.pose(), end)))",
      "        ));",
      "    }",
      "",
      "    @Override",
      "    public void loop() {",
      "        follower.update();",
      "        Scheduler.execute();",
      "        session.update();$0",
      "    }",
      "}",
    ].join("\n"),
    imports: ["Autonomous", "OpMode", "Follower", "Session", "Scheduler", "Constants", "Pose", "PoseFactory", "Groups", "PedroCommands", "Paths", "Headings"].map((name) => CLASSES[name]),
  },
  {
    label: "LinearOpMode TeleOp",
    summary: "TeleOp that runs a loop until STOP",
    body: [
      '@TeleOp(name = "${1:My TeleOp}")',
      "public class ${2:MyTeleOp} extends LinearOpMode {",
      "    @Override",
      "    public void runOpMode() {",
      "        waitForStart();",
      "        while (opModeIsActive()) {",
      "            $0",
      "            telemetry.update();",
      "        }",
      "    }",
      "}",
    ].join("\n"),
    imports: [CLASSES.TeleOp, CLASSES.LinearOpMode],
  },
];
