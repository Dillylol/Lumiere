import { describe, expect, it } from "vitest";
import { RunRecorder, timingDelta, type RunTiming } from "./runTimings";

describe("RunRecorder", () => {
  it("records the reported routine time only once, even before STOP", () => {
    const recorder = new RunRecorder("robot");
    recorder.receive({ type: "hello", source: "robot", protocol: 1, library: "test" }, 0);
    recorder.receive({ type: "lifecycle", opMode: "Auto", phase: "init" }, 200);
    recorder.receive({ type: "lifecycle", opMode: "Auto", phase: "running" }, 400);
    const state = { type: "state", opMode: "Auto", loopMs: 20, data: {
      "lumiere.routineElapsedMs": 1540,
      "lumiere.routineRevision": "routine-a",
    } } as const;
    expect(recorder.receive(state, 2000)).toEqual({
      source: "robot", opMode: "Auto", elapsedMs: 1540, metric: "routine", revision: "routine-a",
    });
    expect(recorder.receive(state, 2100)).toBeUndefined();
    expect(recorder.receive({ type: "lifecycle", opMode: "Auto", phase: "stopped" }, 2500)).toBeUndefined();
  });

  it("records START-to-STOP separately for an uninstrumented run", () => {
    const recorder = new RunRecorder("simulator");
    recorder.receive({ type: "hello", source: "simulator", protocol: 1, library: "test" }, 0);
    recorder.receive({ type: "lifecycle", opMode: "Auto", phase: "init" }, 100);
    recorder.receive({ type: "lifecycle", opMode: "Auto", phase: "running" }, 200);
    recorder.receive({ type: "lifecycle", opMode: "Auto", phase: "running" }, 300);
    expect(recorder.receive({ type: "lifecycle", opMode: "Auto", phase: "stopped" }, 800)).toEqual({
      source: "simulator", opMode: "Auto", elapsedMs: 600, metric: "lifecycle",
    });
  });

  it("skips runs interrupted by an error or reconnect, including replayed running state", () => {
    const recorder = new RunRecorder("robot");
    const hello = { type: "hello", source: "robot", protocol: 1, library: "test" } as const;
    const init = { type: "lifecycle", opMode: "Auto", phase: "init" } as const;
    const start = { ...init, phase: "running" } as const;
    const stop = { ...init, phase: "stopped" } as const;
    recorder.receive(hello, 0);
    recorder.receive(init, 100);
    recorder.receive(start, 200);
    recorder.reset();
    recorder.receive(hello, 300);
    recorder.receive(start, 350);
    expect(recorder.receive(stop, 400)).toBeUndefined();
    recorder.receive(init, 500);
    recorder.receive(start, 600);
    recorder.receive({ type: "error", message: "OpMode failed" }, 650);
    expect(recorder.receive(stop, 700)).toBeUndefined();
  });
});

describe("timingDelta", () => {
  it("compares only the same OpMode, metric, and revision", () => {
    const simulator: RunTiming = { source: "simulator", opMode: "Auto", metric: "routine", elapsedMs: 3000, revision: "a" };
    const robot: RunTiming = { ...simulator, source: "robot", elapsedMs: 3500 };
    expect(timingDelta(simulator, robot)).toBe(500);
    expect(timingDelta(simulator, { ...robot, opMode: "Other" })).toBeUndefined();
    expect(timingDelta(simulator, { ...robot, metric: "lifecycle" })).toBeUndefined();
    expect(timingDelta(simulator, { ...robot, revision: "b" })).toBeUndefined();
  });
});
