import type { Channel } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CancelledError, createRobotProject, installToolchain, runTool, type JobEvent, type RunEvent } from "./backend";
import { readyPort, simulatorGradleArgs, startSimulator } from "./robotProject";

type Call = { cmd: string; args: Record<string, unknown> };

/** Records backend calls and returns the channel so tests can play the backend's side. */
function backend(reply: (call: Call) => unknown = () => 7) {
  const calls: Call[] = [];
  mockIPC((cmd, args) => {
    const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
    calls.push(call);
    return reply(call);
  });
  const channel = <T>(index = 0) => calls[index].args.onEvent as Channel<T>;
  return { calls, channel };
}

afterEach(() => clearMocks());

describe("desktop backend bridge", () => {
  it("settles terminal events even if a UI callback throws", async () => {
    const { channel } = backend();
    const task = await createRobotProject("C:/robot", () => { throw new Error("UI failed"); });
    expect(() => channel<JobEvent<string>>().onmessage({ event: "done", result: "C:/robot" })).toThrow("UI failed");
    await expect(task.result).resolves.toBe("C:/robot");
    const run = await runTool({ tool: "gradle", args: [], cwd: "C:/robot" }, () => { throw new Error("UI failed"); });
    expect(() => channel<RunEvent>(1).onmessage({ event: "error", message: "Build failed" })).toThrow("UI failed");
    await expect(run.result).rejects.toThrow("Build failed");
  });
  it("sends the argument names the Rust commands expect", async () => {
    const { calls, channel } = backend();
    const task = await installToolchain(true);
    expect(calls[0]).toMatchObject({ cmd: "toolchain_install", args: { acceptAndroidSdkLicense: true } });
    expect(task.id).toBe(7);

    const status = { ready: true } as never;
    channel<JobEvent<unknown>>().onmessage({ event: "step", message: "Downloading" });
    channel<JobEvent<unknown>>().onmessage({ event: "done", result: status });
    await expect(task.result).resolves.toBe(status);

    await task.cancel();
    expect(calls[1]).toEqual({ cmd: "cancel", args: { id: 7 } });
  });

  it("rejects failed and cancelled jobs distinctly", async () => {
    const { channel } = backend();
    const events: string[] = [];
    const failed = await createRobotProject("C:/robots/new", (event) => events.push(event.event));
    channel<JobEvent<string>>().onmessage({ event: "failed", message: "Disk full", cancelled: false });
    await expect(failed.result).rejects.toThrow("Disk full");
    expect(events).toEqual(["failed"]);

    const second = backend();
    const cancelled = await createRobotProject("C:/robots/other");
    expect(second.calls[0].args.destination).toBe("C:/robots/other");
    second.channel<JobEvent<string>>().onmessage({ event: "failed", message: "Cancelled.", cancelled: true });
    await expect(cancelled.result).rejects.toBeInstanceOf(CancelledError);
  });

  it("streams tool output and resolves with the exit code", async () => {
    const { calls, channel } = backend();
    const lines: string[] = [];
    const task = await runTool({ tool: "gradle", args: [":TeamCode:assembleDebug"], cwd: "C:/robot" }, (event) => {
      if (event.event === "stdout") lines.push(event.line);
    });
    expect(calls[0].args.request).toEqual({ tool: "gradle", args: [":TeamCode:assembleDebug"], cwd: "C:/robot", env: {} });
    channel<RunEvent>().onmessage({ event: "stdout", line: "BUILD SUCCESSFUL" });
    channel<RunEvent>().onmessage({ event: "exit", code: 0, cancelled: false });
    await expect(task.result).resolves.toEqual({ code: 0, cancelled: false });
    expect(lines).toEqual(["BUILD SUCCESSFUL"]);
  });
});

describe("desktop simulator", () => {
  it("cancels while the first build is still starting", async () => {
    const { calls } = backend();
    const controller = new AbortController();
    const starting = startSimulator("C:/robot", { signal: controller.signal });
    controller.abort();
    await expect(starting).rejects.toThrow("stopped");
    expect(calls).toContainEqual({ cmd: "cancel", args: { id: 7 } });
  });

  it("cancels a startup that never becomes ready", async () => {
    vi.useFakeTimers();
    try {
      const { calls } = backend();
      const starting = startSimulator("C:/robot", { timeoutMs: 100 });
      const assertion = expect(starting).rejects.toThrow("time limit");
      await vi.advanceTimersByTimeAsync(101);
      await assertion;
      expect(calls).toContainEqual({ cmd: "cancel", args: { id: 7 } });
    } finally { vi.useRealTimers(); }
  });
  it("asks for a free port and reads it from the ready line", () => {
    expect(simulatorGradleArgs()).toEqual([
      ":TeamCode:testDebugUnitTest",
      "--tests",
      "org.firstinspires.ftc.teamcode.simulation.RunSimulator",
      "-Psim.port=0",
    ]);
    expect(simulatorGradleArgs("C:/robot/sim.json")).toContain("-Psim.config=C:/robot/sim.json");
    expect(readyPort("    SIMULATOR_READY 51234")).toBe(51234);
    expect(readyPort("> Task :TeamCode:compileDebugJavaWithJavac")).toBeNull();
  });

  it("connects once Gradle reports the simulator is ready", async () => {
    const { calls, channel } = backend();
    const starting = startSimulator("C:/robot");
    await Promise.resolve();
    await Promise.resolve();
    const request = calls[0].args.request as { env: { SIM_TOKEN: string }; args: string[] };
    expect(request.env.SIM_TOKEN).toMatch(/^[0-9a-f]{48}$/);
    channel<RunEvent>().onmessage({ event: "stdout", line: "RunSimulator > run STANDARD_OUT" });
    channel<RunEvent>().onmessage({ event: "stdout", line: "    SIMULATOR_READY 50111" });
    const simulator = await starting;
    expect(simulator).toMatchObject({ url: "ws://127.0.0.1:50111/stream", token: request.env.SIM_TOKEN });
    channel<RunEvent>().onmessage({ event: "exit", code: 0, cancelled: false });
  });

  it("reports the build output when the simulator cannot start", async () => {
    const { channel, calls } = backend();
    const starting = startSimulator("C:/robot");
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    channel<RunEvent>().onmessage({ event: "stderr", line: "Constants.java:12: error: ';' expected" });
    channel<RunEvent>().onmessage({ event: "exit", code: 1, cancelled: false });
    await expect(starting).rejects.toThrow(/exit code 1[\s\S]*';' expected/);
  });
});
