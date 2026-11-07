import type { ServerMessage } from "../core";

export type RunSource = "simulator" | "robot";
export type RunMetric = "routine" | "lifecycle";

export interface RunTiming {
  source: RunSource;
  opMode: string;
  elapsedMs: number;
  metric: RunMetric;
  revision?: string;
}

const ELAPSED_KEY = "lumiere.routineElapsedMs";
const REVISION_KEY = "lumiere.routineRevision";
export function isRunTimingKey(key: string) {
  return key === ELAPSED_KEY || key === REVISION_KEY;
}

const MAX_ENTRIES = 24;
const TIMINGS_CHANGED = "lumiere:run-timings";
const memory = new Map<string, RunTiming[]>();

/**
 * A reconnect can replay the current lifecycle, including RUNNING. Only record
 * a run after observing INIT and RUNNING on one verified connection.
 */
export class RunRecorder {
  private connected = false;
  private initialized?: string;
  private run?: { opMode: string; startMs: number; reported: boolean };

  constructor(private readonly source: RunSource) {}

  reset() {
    this.connected = false;
    this.initialized = undefined;
    this.run = undefined;
  }

  receive(message: ServerMessage, nowMs: number): RunTiming | undefined {
    if (message.type === "hello") {
      this.reset();
      this.connected = message.source === this.source;
      return;
    }
    if (!this.connected) return;

    if (message.type === "error") {
      this.initialized = undefined;
      this.run = undefined;
      return;
    }

    if (message.type === "state") {
      const run = this.run;
      const elapsedMs = message.data?.[ELAPSED_KEY];
      if (!run || run.reported || run.opMode !== message.opMode || typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0) return;
      run.reported = true;
      const revision = message.data?.[REVISION_KEY];
      return {
        source: this.source, opMode: run.opMode, elapsedMs, metric: "routine",
        revision: typeof revision === "string" && revision.length > 0 && revision.length <= 128 ? revision : undefined,
      };
    }

    if (message.type !== "lifecycle") return;
    const opMode = typeof message.opMode === "string" && message.opMode.length > 0 ? message.opMode : undefined;
    switch (message.phase) {
      case "init":
        this.initialized = opMode;
        this.run = undefined;
        return;
      case "running":
        if (opMode && this.initialized === opMode) this.run = { opMode, startMs: nowMs, reported: false };
        else if (this.run?.opMode !== opMode) this.run = undefined;
        this.initialized = undefined;
        return;
      case "idle":
      case "stopped": {
        const run = this.run;
        this.initialized = undefined;
        this.run = undefined;
        if (message.phase !== "stopped" || !run || run.reported || run.opMode !== opMode) return;
        const elapsedMs = nowMs - run.startMs;
        if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
          return { source: this.source, opMode: run.opMode, elapsedMs, metric: "lifecycle" };
        }
      }
    }
  }
}

function storageKey(projectId: string) {
  return "lumiere-run-timings:" + projectId;
}

function isTiming(value: unknown): value is RunTiming {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RunTiming>;
  return (item.source === "simulator" || item.source === "robot")
    && (item.metric === "routine" || item.metric === "lifecycle")
    && typeof item.opMode === "string" && item.opMode.length > 0
    && typeof item.elapsedMs === "number" && Number.isFinite(item.elapsedMs) && item.elapsedMs >= 0
    && (item.revision === undefined || typeof item.revision === "string");
}

export function readRunTimings(projectId: string): RunTiming[] {
  const key = storageKey(projectId);
  const unsaved = memory.get(key);
  if (unsaved) return unsaved;
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(data) ? data.filter(isTiming).slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

export function saveRunTiming(projectId: string, timing: RunTiming) {
  const key = storageKey(projectId);
  const previous = readRunTimings(projectId);
  const latest = [timing, ...previous.filter(item => item.opMode !== timing.opMode || item.source !== timing.source || item.metric !== timing.metric)]
    .slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(key, JSON.stringify(latest));
    memory.delete(key);
  } catch {
    memory.set(key, latest);
  }
  window.dispatchEvent(new Event(TIMINGS_CHANGED));
}

export function subscribeToRunTimings(projectId: string, change: () => void) {
  const storageChanged = (event: StorageEvent) => {
    if (event.key === storageKey(projectId) || event.key === null) change();
  };
  window.addEventListener(TIMINGS_CHANGED, change);
  window.addEventListener("storage", storageChanged);
  return () => {
    window.removeEventListener(TIMINGS_CHANGED, change);
    window.removeEventListener("storage", storageChanged);
  };
}

/** Different revisions or different timing endpoints are not comparable. */
export function timingDelta(simulator?: RunTiming, robot?: RunTiming) {
  if (!simulator || !robot || simulator.opMode !== robot.opMode || simulator.metric !== robot.metric
      || simulator.revision !== robot.revision) return undefined;
  return robot.elapsedMs - simulator.elapsedMs;
}
