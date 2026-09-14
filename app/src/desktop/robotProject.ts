/**
 * Everyday robot-project actions on the desktop, built on the backend's Gradle and adb runner:
 * check, build, deploy, and the desktop simulator.
 */
import { simulatorStreamUrl } from "../core";
import { runTool, type ExitResult, type RunEvent, type RunningTask } from "./backend";

/** Gradle task lists. Project folders come from `createRobotProject` or a folder the user opened. */
export const GRADLE_TASKS = {
  /** Compiles TeamCode only; the fastest way to find Java errors. */
  check: [":TeamCode:compileDebugJavaWithJavac"],
  build: [":TeamCode:assembleDebug"],
  /** Installs on a Robot Controller that adb is connected to. */
  deploy: [":TeamCode:installDebug"],
  test: [":TeamCode:testDebugUnitTest"],
} as const;

/** The Control Hub's adb address on robot Wi-Fi. */
export const CONTROL_HUB_ADB_ADDRESS = "192.168.43.1:5555";

export const SIMULATOR_TEST_CLASS = "org.firstinspires.ftc.teamcode.simulation.RunSimulator";
const READY = /SIMULATOR_READY (\d+)/;

export function simulatorGradleArgs(configPath?: string): string[] {
  // Port 0 lets the simulator pick a free port and report it, so nothing can take it in between.
  const args = [...GRADLE_TASKS.test, "--tests", SIMULATOR_TEST_CLASS, "-Psim.port=0"];
  if (configPath) args.push(`-Psim.config=${configPath}`);
  return args;
}

/** The port from the simulator's ready line, or null for any other output line. */
export function readyPort(line: string): number | null {
  const match = READY.exec(line);
  return match ? Number(match[1]) : null;
}

export function gradle(projectDir: string, args: readonly string[], onEvent?: (event: RunEvent) => void): Promise<RunningTask<ExitResult>> {
  return runTool({ tool: "gradle", args: [...args], cwd: projectDir }, onEvent);
}

export function adbConnect(projectDir: string, address = CONTROL_HUB_ADB_ADDRESS, onEvent?: (event: RunEvent) => void) {
  return runTool({ tool: "adb", args: ["connect", address], cwd: projectDir }, onEvent);
}

export interface DesktopSimulator {
  /** Pass both to `new StreamClient({ url, token })`. */
  url: string;
  token: string;
  /** The Gradle run. Send `shutdown` over the stream to stop cleanly; `task.cancel()` stops it at once. */
  task: RunningTask<ExitResult>;
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Starts the real-Java simulator for a robot project and resolves once it accepts connections.
 * The first run downloads and compiles dependencies, so allow several minutes.
 */
export async function startSimulator(
  projectDir: string,
  options: { configPath?: string; onEvent?: (event: RunEvent) => void; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<DesktopSimulator> {
  if (options.signal?.aborted) throw new Error("The simulator was stopped.");
  const token = newToken();
  const recent: string[] = [];
  let found: (port: number) => void = () => {};
  const ready = new Promise<number>((resolve) => {
    found = resolve;
  });
  const task = await runTool(
    { tool: "gradle", args: simulatorGradleArgs(options.configPath), cwd: projectDir, env: { SIM_TOKEN: token } },
    (event) => {
      if (event.event === "stdout" || event.event === "stderr") {
        recent.push(event.line);
        if (recent.length > 40) recent.shift();
        const port = readyPort(event.line);
        if (port !== null) found(port);
      }
      options.onEvent?.(event);
    },
  );
  const exited = task.result.then(
    (result) => {
      throw new Error(
        result.cancelled ? "The simulator was stopped." : `The simulator did not start (Gradle exit code ${result.code}).\n${recent.join("\n")}`,
      );
    },
  );
  let stop: () => void = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    const cancel = (message: string) => {
      void task.cancel().catch(() => {});
      reject(new Error(message));
    };
    stop = () => cancel("The simulator was stopped.");
    options.signal?.addEventListener("abort", stop, { once: true });
    if (options.signal?.aborted) stop();
    timer = setTimeout(() => cancel("The simulator did not start within the time limit. Check the build output and try again."), options.timeoutMs ?? 600_000);
  });
  try {
    const port = await Promise.race([ready, exited, interrupted]);
    return { url: simulatorStreamUrl(port), token, task };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", stop);
  }
}
