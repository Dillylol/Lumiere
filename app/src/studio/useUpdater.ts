import { useCallback, useEffect, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { isDesktop } from "../desktop/backend";

export type UpdaterPhase = "unavailable" | "checking" | "current" | "available" | "downloading" | "restarting" | "error";

export interface UpdaterState {
  phase: UpdaterPhase;
  version?: string;
  notes?: string;
  progress?: number;
  message?: string;
}

export function useUpdater() {
  const [state, setState] = useState<UpdaterState>({ phase: isDesktop() ? "checking" : "unavailable" });
  const [available, setAvailable] = useState<Update | null>(null);

  const checkNow = useCallback(async () => {
    if (!isDesktop()) return;
    setState({ phase: "checking" });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check({ timeout: 15_000 });
      setAvailable(update);
      setState(update
        ? { phase: "available", version: update.version, notes: update.body }
        : { phase: "current" });
    } catch (error) {
      setState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    if (isDesktop()) void checkNow();
  }, [checkNow]);

  useEffect(() => () => {
    if (available) void available.close();
  }, [available]);

  const install = useCallback(async () => {
    if (!available) return;
    let received = 0;
    let total = 0;
    setState({ phase: "downloading", version: available.version, progress: 0 });
    try {
      await available.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") received += event.data.chunkLength;
        setState({
          phase: "downloading",
          version: available.version,
          progress: total ? Math.min(100, Math.round((received / total) * 100)) : undefined,
        });
      });
      setState({ phase: "restarting", version: available.version });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (error) {
      setState({ phase: "error", version: available.version, message: error instanceof Error ? error.message : String(error) });
    }
  }, [available]);

  return { state, checkNow, install };
}
