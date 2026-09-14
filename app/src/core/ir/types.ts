/**
 * Project format version 2: the single source of truth for a team's robot program.
 *
 * Coordinates use Pedro Pathing field coordinates: inches from the bottom-left corner of the field
 * (0 to 144 on both axes), with heading 0 along +x and angles increasing counterclockwise. Headings
 * are stored in degrees because that is what students read and type; generated code converts them.
 *
 * Path geometry and headings follow the Pedro Pathing Visualizer's `.pp` model so paths can be
 * imported and exported without loss.
 */

export const PROJECT_FORMAT = "ftc-robot-project";
export const PROJECT_VERSION = 2;
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

export interface RobotProfile {
  widthInches: number;
  lengthInches: number;
  /** Top speed used by the web preview, in inches per second. */
  maxVelocity: number;
  /** Acceleration used by the web preview, in inches per second squared. */
  maxAcceleration: number;
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
