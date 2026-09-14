/**
 * Typed access to the desktop backend (app/src-tauri). Only available in the desktop app; check
 * `isDesktop()` first. The web app uses the preview and never calls these.
 *
 * Long operations return a `RunningTask` right away: `result` settles when the work ends, and
 * `cancel()` stops it (including every process a Gradle build started).
 */
import { Channel, invoke } from "@tauri-apps/api/core";

export type ToolSource = "androidStudio" | "javaHome" | "androidHome" | "defaultLocation" | "app";

export interface JavaInstall {
  home: string;
  version: string;
  major: number;
  source: ToolSource;
  /** Robot projects build with Java 17 through 21. */
  supported: boolean;
}

export interface AndroidSdkInstall {
  path: string;
  source: ToolSource;
  missingPackages: string[];
  licenseAccepted: boolean;
}

export interface ToolchainStatus {
  java: JavaInstall | null;
  /** Every Java found, including unsupported versions. */
  javaFound: JavaInstall[];
  androidSdk: AndroidSdkInstall | null;
  adb: string | null;
  /** `"java"`, `"androidSdk"`, or Android SDK package ids such as `"platforms;android-34"`. */
  missing: string[];
  ready: boolean;
  install: {
    java: string;
    commandLineTools: string;
    /** Show this link next to the license checkbox before calling `installToolchain`. */
    licenseUrl: string;
    location: string;
    available: boolean;
  };
}

export type JobEvent<T> =
  | { event: "step"; message: string }
  | { event: "progress"; received: number; total: number | null }
  | { event: "log"; line: string }
  | { event: "done"; result: T }
  | { event: "failed"; message: string; cancelled: boolean };

export type RunEvent =
  | { event: "stdout"; line: string }
  | { event: "stderr"; line: string }
  | { event: "exit"; code: number | null; cancelled: boolean }
  | { event: "error"; message: string };

export interface RunRequest {
  tool: "gradle" | "adb";
  args: string[];
  /** Absolute path of the robot project folder. */
  cwd: string;
  env?: { SIM_TOKEN?: string };
}

export interface ExitResult {
  code: number | null;
  cancelled: boolean;
}

export interface RunningTask<T> {
  id: number;
  result: Promise<T>;
  cancel(): Promise<boolean>;
}

/** Rejection reason when a task was cancelled. */
export class CancelledError extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "CancelledError";
  }
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function toolchainStatus(): Promise<ToolchainStatus> {
  return invoke<ToolchainStatus>("toolchain_status");
}

export function cancelTask(id: number): Promise<boolean> {
  return invoke<boolean>("cancel", { id });
}

async function startJob<T>(
  command: string,
  args: Record<string, unknown>,
  onEvent?: (event: JobEvent<T>) => void,
): Promise<RunningTask<T>> {
  const channel = new Channel<JobEvent<T>>();
  // The channel exists before the command starts, so no event can be missed.
  const result = new Promise<T>((resolve, reject) => {
    channel.onmessage = (event) => {
      if (event.event === "done") resolve(event.result);
      else if (event.event === "failed") reject(event.cancelled ? new CancelledError() : new Error(event.message));
      onEvent?.(event);
    };
  });
  const id = await invoke<number>(command, { ...args, onEvent: channel });
  return { id, result, cancel: () => cancelTask(id) };
}

/**
 * Installs missing Java and Android tools. The user must have accepted the Android SDK License
 * (`status.install.licenseUrl`) when Android packages are missing; otherwise this rejects.
 */
export function installToolchain(
  acceptAndroidSdkLicense: boolean,
  onEvent?: (event: JobEvent<ToolchainStatus>) => void,
): Promise<RunningTask<ToolchainStatus>> {
  return startJob("toolchain_install", { acceptAndroidSdkLicense }, onEvent);
}

/**
 * Creates a robot project (official FTC SDK plus Pedro Pathing, Panels, and examples) in an empty or
 * new folder, and grants the app access to it. Resolves to the project path.
 */
export function createRobotProject(destination: string, onEvent?: (event: JobEvent<string>) => void): Promise<RunningTask<string>> {
  return startJob("quickstart_create", { destination }, onEvent);
}

/** Runs the project's Gradle wrapper or adb. Resolves with the exit code, including after cancel. */
export async function runTool(request: RunRequest, onEvent?: (event: RunEvent) => void): Promise<RunningTask<ExitResult>> {
  const channel = new Channel<RunEvent>();
  const result = new Promise<ExitResult>((resolve, reject) => {
    channel.onmessage = (event) => {
      if (event.event === "exit") resolve({ code: event.code, cancelled: event.cancelled });
      else if (event.event === "error") reject(new Error(event.message));
      onEvent?.(event);
    };
  });
  const id = await invoke<number>("run", { request: { ...request, env: request.env ?? {} }, onEvent: channel });
  return { id, result, cancel: () => cancelTask(id) };
}

export interface SdkChange {
  /** Path relative to the robot project folder. */
  path: string;
  action: "created" | "updated" | "kept";
  note: string | null;
}

/**
 * Adds what generated code needs to an existing FTC SDK project: Pedro Pathing, Ivy, Panels, the robot
 * library, and the simulator entry point. With `includePedroSetup`, also the Pedro Pathing constants
 * class and AutoTune procedures. Existing files are never replaced.
 */
export function addSdkLibraries(folder: string, includePedroSetup: boolean, onEvent?: (event: JobEvent<SdkChange[]>) => void): Promise<RunningTask<SdkChange[]>> {
  return startJob("sdk_add_libraries", { folder, includePedroSetup }, onEvent);
}
