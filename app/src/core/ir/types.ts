/**
 * Project format version 3: the single source of truth for a team's robot program. Version 3 adds
 * the robot profile read from the team's Pedro Pathing constants and the robot's hardware scan.
 *
 * Coordinates use Pedro Pathing field coordinates: inches from the bottom-left corner of the field
 * (0 to 144 on both axes), with heading 0 along +x and angles increasing counterclockwise. Headings
 * are stored in degrees because that is what students read and type; generated code converts them.
 *
 * Path geometry and headings follow the Pedro Pathing Visualizer's `.pp` model so paths can be
 * imported and exported without loss.
 */

export const PROJECT_FORMAT = "ftc-robot-project";
export const PROJECT_VERSION = 3;
export const FIELD_INCHES = 144;

export interface Point {
  x: number;
  y: number;
}

export interface StartPose extends Point {
  headingDeg: number;
}

/** How the robot turns while following a path. */
export type Heading =
  /** Turns evenly from `startDeg` to `endDeg`, the short way around. */
  | { type: "linear"; startDeg: number; endDeg: number }
  /** Faces one direction the whole way. */
  | { type: "constant"; degrees: number }
  /** Faces along the path, or backwards along it when `reverse` is set. */
  | { type: "tangential"; reverse: boolean }
  /** Different rules over different parts of the path. */
  | { type: "piecewise"; segments: HeadingSegment[] };

export type HeadingSegment = {
  /** Fraction of the path's length where this rule starts, 0 to 1. */
  startProgress: number;
  /** Fraction of the path's length where this rule ends, 0 to 1. */
  endProgress: number;
} & (
  | { type: "linear"; startDeg: number; endDeg: number }
  | { type: "constant"; degrees: number }
  | { type: "tangential"; reverse: boolean }
  | { type: "facingPoint"; point: Point }
);

interface PathCommon {
  id: string;
  name: string;
  color: string;
}

/** One straight line (no control points) or Bezier curve ending at `end`. */
export interface AtomicPath extends PathCommon {
  kind: "atomic";
  end: Point;
  controlPoints: Point[];
  heading: Heading;
}

/**
 * Several paths followed as one without stopping. When `heading` is set it applies across the
 * whole group; otherwise each segment keeps its own heading.
 */
export interface CompoundPath extends PathCommon {
  kind: "compound";
  segments: AtomicPath[];
  heading: Heading | null;
}

export type PathDoc = AtomicPath | CompoundPath;

/** A step in an autonomous routine. Steps run in order unless grouped. */
export type Step =
  | { id: string; kind: "path"; pathId: string }
  | { id: string; kind: "wait"; ms: number }
  | { id: string; kind: "state"; subsystemId: string; stateId: string }
  /** Runs every child at once and finishes when all have finished. */
  | { id: string; kind: "together"; steps: Step[] }
  /** Runs every child at once and finishes as soon as the first one finishes. */
  | { id: string; kind: "race"; steps: Step[] };

export type StepKind = Step["kind"];

export interface AutonomousProgram {
  id: string;
  kind: "autonomous";
  /** The name shown on the Driver Station. */
  name: string;
  group: string;
  /** Name of the TeleOp the Driver Station selects after this autonomous. */
  preselectTeleOp: string | null;
  start: StartPose;
  /** Paths in driving order. Each path starts where the previous one ends. */
  paths: PathDoc[];
  routine: Step[];
}

export type GamepadButton =
  | "a" | "b" | "x" | "y"
  | "dpad_up" | "dpad_down" | "dpad_left" | "dpad_right"
  | "left_bumper" | "right_bumper"
  | "left_stick_button" | "right_stick_button"
  | "back" | "start" | "guide";

export type BindingAction =
  /** Sets a state when the button is pressed. */
  | { kind: "state"; subsystemId: string; stateId: string }
  /** Alternates between two states on each press. */
  | { kind: "toggle"; subsystemId: string; firstStateId: string; secondStateId: string }
  /** Holds one state while the button is held and another when it is released. */
  | { kind: "hold"; subsystemId: string; heldStateId: string; releasedStateId: string };

export interface Binding {
  id: string;
  gamepad: 1 | 2;
  button: GamepadButton;
  action: BindingAction;
}

export interface TeleOpProgram {
  id: string;
  kind: "teleop";
  name: string;
  group: string;
  drive: {
    /** Field-centric: pushing the stick forward always moves away from the driver. */
    fieldCentric: boolean;
    /** Button held for slow driving, or null for none. */
    slowModeButton: GamepadButton | null;
    /** Speed multiplier while slow mode is held, above 0 and at most 1. */
    slowModeScale: number;
    /** Button that sets "forward" to the robot's current heading, or null for none. */
    resetHeadingButton: GamepadButton | null;
  };
  /** Starting pose when no autonomous ran first. */
  start: StartPose;
  bindings: Binding[];
}

export type Program = AutonomousProgram | TeleOpProgram;

export type DeviceKind = "motor" | "servo" | "crservo";

export interface Device {
  id: string;
  /** The name in the Robot Controller configuration. */
  name: string;
  kind: DeviceKind;
  reversed: boolean;
}

export type Output =
  /** Motor or continuous-rotation servo power, -1 to 1. */
  | { kind: "power"; value: number }
  /** Servo position, 0 to 1. */
  | { kind: "position"; value: number }
  /** Motor encoder target in ticks, driven at up to `power` (0 to 1). */
  | { kind: "target"; ticks: number; power: number };

export interface MechanismState {
  id: string;
  name: string;
  /** Output for each device, keyed by device id. Devices without an entry are left unchanged. */
  outputs: Record<string, Output>;
}

/** A mechanism such as a claw, lift, or intake, with named states. */
export interface Subsystem {
  id: string;
  name: string;
  devices: Device[];
  states: MechanismState[];
  /** State applied when an OpMode initializes, or null to leave the hardware untouched. */
  initialStateId: string | null;
}

export type DriveMotorPosition = "frontLeft" | "frontRight" | "backLeft" | "backRight";
export const DRIVE_MOTOR_POSITIONS: readonly DriveMotorPosition[] = ["frontLeft", "frontRight", "backLeft", "backRight"];

export interface DriveMotor {
  name: string;
  reversed: boolean;
}

/**
 * A device Pedro Pathing drives. Its role is Pedro's own setting name without "Name": `frontLeft` from
 * `MecanumConfig.frontLeftName`, `leftEncoder` from `ThreeWheelConfig.leftEncoderName`, `xPod` from
 * `TwoWheelConfig.xPodName`. A localizer with a single device, such as the Pinpoint, gives that device
 * the localizer's kind as its role (`pinpoint`).
 */
export interface PedroDevice {
  role: string;
  /** The name in the Robot Controller configuration. */
  name: string;
}

/** A device the localizer uses, as the team's constants class sets it. */
export interface LocalizerDevice extends PedroDevice {
  /** A dead wheel whose encoder counts backwards (Pedro's `Encoder.REVERSE`). */
  reversed?: boolean;
  /** A dead wheel's distance per encoder tick, in inches (Pedro's ticks-to-inches setting). */
  inchesPerTick?: number;
}

export interface RobotLocalizer {
  /** `pinpoint` for the goBILDA Pinpoint; otherwise the Pedro config type in lower case without "config", such as `otos` or `threewheelimu`. */
  kind: string;
  /** The device name in the Robot Controller configuration, when the config sets one. */
  name?: string;
  /** Pinpoint pod offsets from the robot's center, in inches. */
  xPodOffset?: number;
  yPodOffset?: number;
  /** Every device the localizer config names, such as three dead wheels and an IMU. */
  devices?: LocalizerDevice[];
}

/** A configured device the robot reported in its manifest. */
export interface ScannedDevice {
  name: string;
  /** `motor`, `servo`, `crservo`, `imu`, `voltage`, `pinpoint`, `otos`, `camera`, … (see docs/protocol.md). */
  type: string;
}

/** What the robot reported about Pedro Pathing, read from the constants class it runs. */
export interface ScannedPedro {
  /** The constants class the robot read. */
  constants: string;
  /** The localizer's kind, as in {@link RobotLocalizer.kind}, or null when none was found. */
  localizer: string | null;
  devices: PedroDevice[];
}

/**
 * The physical robot. The footprint, acceleration and turn rate are the team's to set. When the
 * project is linked to an FTC SDK project, the drive motors, localizer, velocities and decelerations
 * follow the team's Pedro Pathing constants class (`constants` records where they came from).
 */
export interface RobotProfile {
  widthInches: number;
  /** Measured along the robot's heading. */
  lengthInches: number;
  /** Full-power speed driving forward, in inches per second (Pedro's `maxAchievableForwardVelocity`). */
  maxForwardVelocity: number;
  /** Full-power speed strafing sideways, in inches per second (Pedro's `maxAchievableStrafeVelocity`). */
  maxStrafeVelocity: number;
  /** How quickly the robot slows when coasting forward, in in/s² (Pedro's `naturalForwardDeceleration`). */
  forwardDeceleration: number;
  /** How quickly the robot slows when coasting sideways, in in/s² (Pedro's `naturalStrafeDeceleration`). */
  strafeDeceleration: number;
  /** How quickly the robot speeds up from rest, in in/s². */
  acceleration: number;
  /** How fast the robot turns in place, in degrees per second. */
  turnRateDeg: number;
  drivetrain?: Record<DriveMotorPosition, DriveMotor>;
  localizer?: RobotLocalizer;
  /** Set while the values above follow the team's Pedro constants. */
  constants?: {
    /** The constants file, relative to the FTC SDK project. */
    file: string;
    /** When the values last changed. */
    readAt: string;
    /** The class's `TUNED` flag, or null when it has none. */
    tuned: boolean | null;
    /** Settings Lumière could not read because they are computed rather than written as values. */
    unreadable: string[];
  };
  /**
   * The configured hardware the robot last reported, and the devices Pedro Pathing drives on it.
   * `scannedAt` is when that report last changed.
   */
  scan?: { devices: ScannedDevice[]; scannedAt: string; pedro?: ScannedPedro };
}

export interface Project {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  robot: RobotProfile;
  subsystems: Subsystem[];
  programs: Program[];
}
