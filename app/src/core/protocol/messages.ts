/** Types for stream protocol version 1. See docs/protocol.md. */

export const PROTOCOL_VERSION = 1;
export const ROBOT_PORT = 58080;
export const STREAM_PATH = "/stream";
/** Robot Controller addresses on robot Wi-Fi: REV Control Hub, then an Android phone. */
export const ROBOT_HOSTS = ["192.168.43.1", "192.168.49.1"] as const;

export interface PoseMessage {
  x: number;
  y: number;
  /** Radians. */
  heading: number;
}

export interface DeviceInfo {
  name: string;
  type: string;
}

export interface OpModeInfo {
  name: string;
  group: string;
  flavor: "autonomous" | "teleop" | "utility";
}

export type Phase = "idle" | "init" | "running" | "stopped";

export type ServerMessage =
  | {
      type: "hello";
      protocol: number;
      source: "robot" | "simulator";
      library: string;
      drivetrain?: { motors: string[]; localizer: string | null; source: string };
      robot?: { widthInches: number; lengthInches: number };
    }
  | { type: "manifest"; devices: DeviceInfo[]; opModes: OpModeInfo[] }
  | { type: "lifecycle"; opMode: string | null; phase: Phase }
  | {
      type: "state";
      opMode: string;
      loopMs: number;
      pose?: PoseMessage;
      follower?: "follow" | "hold" | "manual" | "idle";
      target?: PoseMessage;
      data?: Record<string, unknown>;
    }
  | { type: "path"; points: [number, number][] }
  | {
      type: "robot";
      opMode: string | null;
      phase: Phase;
      elapsed: number;
      pose: PoseMessage;
      velocity: PoseMessage;
      voltage: number;
      devices: Record<string, { type: string; power?: number; position?: number | null }>;
    }
  | { type: "telemetry"; lines: string[] }
  | {
      type: "error";
      message: string;
      opMode?: string | null;
      stack?: { class: string; method: string; file: string | null; line: number }[];
    }
  | { type: "pong"; t: unknown };

export type ServerMessageType = ServerMessage["type"];

export interface GamepadStateMessage {
  left_stick_x?: number;
  left_stick_y?: number;
  right_stick_x?: number;
  right_stick_y?: number;
  left_trigger?: number;
  right_trigger?: number;
  dpad_up?: boolean;
  dpad_down?: boolean;
  dpad_left?: boolean;
  dpad_right?: boolean;
  a?: boolean;
  b?: boolean;
  x?: boolean;
  y?: boolean;
  guide?: boolean;
  start?: boolean;
  back?: boolean;
  left_bumper?: boolean;
  right_bumper?: boolean;
  left_stick_button?: boolean;
  right_stick_button?: boolean;
  touchpad?: boolean;
}

export type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "ping"; t: number }
  | { type: "stop" }
  | { type: "init"; opMode: string }
  | { type: "start" }
  | { type: "gamepad"; index: 1 | 2; state: GamepadStateMessage }
  | { type: "place"; x: number; y: number; heading: number }
  | { type: "shutdown" };

const TYPES = new Set<string>(["hello", "manifest", "lifecycle", "state", "path", "robot", "telemetry", "error", "pong"]);

/** Parses a frame, returning null for anything that is not a known server message. */
export function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== "string") return null;
  try {
    const value = JSON.parse(data) as { type?: unknown };
    if (!value || typeof value !== "object" || typeof value.type !== "string" || !TYPES.has(value.type)) return null;
    return value as ServerMessage;
  } catch {
    return null;
  }
}

export function robotStreamUrl(host: string): string {
  return `ws://${host}:${ROBOT_PORT}${STREAM_PATH}`;
}

export function simulatorStreamUrl(port: number): string {
  return `ws://127.0.0.1:${port}${STREAM_PATH}`;
}

/**
 * Converts a Web Gamepad API gamepad with the "standard" mapping to FTC's field names. FTC reports
 * stick up and left as negative, which matches the Gamepad API's axes.
 */
export function fromBrowserGamepad(gamepad: Pick<Gamepad, "axes" | "buttons" | "mapping">, deadzone = 0.05): GamepadStateMessage {
  const axis = (index: number) => {
    const value = gamepad.axes[index] ?? 0;
    return Math.abs(value) < deadzone ? 0 : Math.max(-1, Math.min(1, value));
  };
  const button = (index: number) => Boolean(gamepad.buttons[index]?.pressed);
  const trigger = (index: number) => Math.max(0, Math.min(1, gamepad.buttons[index]?.value ?? 0));
  return {
    left_stick_x: axis(0),
    left_stick_y: axis(1),
    right_stick_x: axis(2),
    right_stick_y: axis(3),
    a: button(0),
    b: button(1),
    x: button(2),
    y: button(3),
    left_bumper: button(4),
    right_bumper: button(5),
    left_trigger: trigger(6),
    right_trigger: trigger(7),
    back: button(8),
    start: button(9),
    left_stick_button: button(10),
    right_stick_button: button(11),
    dpad_up: button(12),
    dpad_down: button(13),
    dpad_left: button(14),
    dpad_right: button(15),
    guide: button(16),
    touchpad: button(17),
  };
}
