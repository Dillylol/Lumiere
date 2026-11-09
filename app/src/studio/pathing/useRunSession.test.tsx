import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SocketLike } from "../../core";
import type { ExitResult, RunningTask } from "../../desktop/backend";
import type { DesktopSimulator } from "../../desktop/robotProject";
import { useRunSession, type RunSessionOptions } from "./useRunSession";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: { type: string; [key: string]: unknown }[] = [];
  private listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {};
  constructor(readonly url: string) {}
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.emit("close", {}); }
  addEventListener(type: string, listener: (event: { data?: unknown }) => void) { (this.listeners[type] ??= []).push(listener); }
  open() { this.readyState = 1; this.emit("open", {}); }
  receive(message: object) { this.emit("message", { data: JSON.stringify(message) }); }
  commands() { return this.sent.filter((message) => message.type !== "ping").map((message) => message.type); }
  private emit(type: string, event: { data?: unknown }) { (this.listeners[type] ?? []).forEach((listener) => listener(event)); }
}

function setup(options: Partial<RunSessionOptions>) {
  const sockets: FakeSocket[] = [];
  const onLog = vi.fn();
  const hook = renderHook(() => useRunSession({
    source: "simulator", projectId: "project", programName: "Main Auto", onLog,
    socketFactory: (url) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    ...options,
  }));
  return { ...hook, sockets, onLog };
}

const last = <T,>(items: T[]) => items[items.length - 1];

afterEach(() => localStorage.clear());

describe("useRunSession", () => {
  it("launches the simulator, runs this program's OpMode, keeps the trail, and stops at the match timer", async () => {
    const task = { id: 1, result: new Promise<ExitResult>(() => {}), cancel: vi.fn(() => Promise.resolve(true)) } satisfies RunningTask<ExitResult>;
    const launch = vi.fn(async (): Promise<DesktopSimulator> => ({ url: "ws://127.0.0.1:5000/stream", token: "secret", task }));
    const { result, sockets, unmount } = setup({ launch, cancel: vi.fn(), canLaunch: true });

    await act(async () => { result.current.open(); });
    expect(launch).toHaveBeenCalledOnce();
    const socket = sockets[0];
    expect(socket.url).toBe("ws://127.0.0.1:5000/stream");
    act(() => socket.open());
    expect(socket.sent[0]).toEqual({ type: "auth", token: "secret" });
    expect(result.current.status).toBe("Connected");

    // The program's own OpMode is chosen from the manifest.
    act(() => {
      socket.receive({ type: "hello", protocol: 1, source: "simulator", library: "sim" });
      socket.receive({ type: "manifest", opModes: [{ name: "Other Auto", flavor: "autonomous" }, { name: "Main Auto", flavor: "autonomous" }] });
    });
    expect(result.current.mode).toBe("Main Auto");
    act(() => result.current.init());
    expect(last(socket.sent)).toEqual({ type: "init", opMode: "Main Auto" });
    act(() => socket.receive({ type: "lifecycle", opMode: "Main Auto", phase: "init" }));
    act(() => result.current.start());
    expect(last(socket.sent)).toEqual({ type: "start" });

    // While it runs, the true pose is drawn and its trail kept, a point every half inch.
    act(() => {
      socket.receive({ type: "lifecycle", opMode: "Main Auto", phase: "running" });
      for (const [elapsed, x] of [[1, 10], [1.1, 10.2], [2, 20]]) {
        socket.receive({ type: "robot", opMode: "Main Auto", phase: "running", elapsed, pose: { x, y: 10, heading: 0 } });
      }
    });
    expect(result.current.active).toBe("Main Auto");
    expect(result.current.phase).toBe("running");
    expect(result.current.pose).toEqual({ x: 20, y: 10, heading: 0 });
    expect(result.current.trail).toEqual([{ x: 10, y: 10 }, { x: 20, y: 10 }]);
    expect(result.current.elapsed).toBe(2000);

    // The 30-second match timer presses STOP.
    act(() => socket.receive({ type: "robot", opMode: "Main Auto", phase: "running", elapsed: 30.05, pose: { x: 30, y: 10, heading: 0 } }));
    expect(last(socket.commands())).toBe("stop");

    // A new INIT clears the last run's trail.
    act(() => socket.receive({ type: "lifecycle", opMode: "Main Auto", phase: "init" }));
    expect(result.current.trail).toEqual([]);

    // Leaving presses STOP, shuts the simulator down, and cancels its task.
    socket.sent.length = 0;
    unmount();
    expect(socket.commands()).toEqual(["stop", "shutdown"]);
    expect(task.cancel).toHaveBeenCalled();
  });

  it("does not launch without an FTC SDK project, and drives gamepad 1 from the on-screen buttons", async () => {
    vi.useFakeTimers();
    try {
      const task = { id: 1, result: new Promise<ExitResult>(() => {}), cancel: vi.fn(() => Promise.resolve(true)) } satisfies RunningTask<ExitResult>;
      const launch = vi.fn(async (): Promise<DesktopSimulator> => ({ url: "ws://127.0.0.1:5000/stream", token: "secret", task }));
      const blocked = setup({ launch, canLaunch: false });
      await act(async () => { blocked.result.current.open(); });
      expect(launch).not.toHaveBeenCalled();
      blocked.unmount();

      const { result, sockets, unmount } = setup({ launch, canLaunch: true });
      await act(async () => { result.current.open(); });
      act(() => sockets[0].open());
      act(() => result.current.press("a", true));
      act(() => { vi.advanceTimersByTime(60); });
      const pad = sockets[0].sent.filter((message) => message.type === "gamepad").slice(-1)[0];
      expect(pad).toMatchObject({ type: "gamepad", index: 1, state: { a: true, left_stick_x: 0 } });
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("watches a robot: times the run from START, reports its hardware, and only sends STOP", () => {
    const onScan = vi.fn();
    const { result, sockets } = setup({ source: "robot", host: "10.0.0.5", onScan });
    act(() => result.current.open());
    const socket = sockets[0];
    expect(socket.url).toBe("ws://10.0.0.5:58080/stream");
    act(() => socket.open());
    act(() => {
      socket.receive({ type: "hello", protocol: 1, source: "robot", library: "hub" });
      socket.receive({ type: "manifest", opModes: [], devices: [{ name: "claw", type: "servo" }] });
      socket.receive({ type: "lifecycle", opMode: "Main Auto", phase: "init" });
      socket.receive({ type: "lifecycle", opMode: "Main Auto", phase: "running" });
      socket.receive({ type: "state", opMode: "Main Auto", pose: { x: 5, y: 6, heading: 0 }, follower: "follow", loopMs: 12 });
    });
    expect(onScan).toHaveBeenCalledWith([{ name: "claw", type: "servo" }]);
    expect(result.current.pose).toEqual({ x: 5, y: 6, heading: 0 });
    expect(result.current.follower).toBe("follow");
    act(() => result.current.stop());
    expect(socket.commands()).toEqual(["stop"]);
    act(() => result.current.disconnect());
    expect(result.current.status).toBe("Disconnected");
    expect(result.current.hello).toBeUndefined();
  });
});
