import { useEffect, useMemo, useRef, useState } from "react";
import {
  describeDeploy,
  hasErrors,
  inspectFtcProject,
  javaPackageDirectory,
  ownershipOf,
  planDeploy,
  validateProject,
  type DeployPlan,
  type FtcProjectInspection,
  type JavaTarget,
  type Project,
} from "../core";
import { addSdkLibraries, createRobotProject, installToolchain, isDesktop, toolchainStatus, type RunEvent, type RunningTask, type SdkChange, type ToolchainStatus } from "../desktop/backend";
import { applyDeployPlan, joinPath, readDeployFiles, readFtcProject } from "../desktop/ftcFolder";
import { adbConnect, gradle, GRADLE_TASKS, startSimulator, type DesktopSimulator } from "../desktop/robotProject";
import { loadSdkLink, newSdkLink, saveSdkLink, type SdkLink } from "./sdkLink";
import { confirmAction } from "./store";

export interface JavaFile {
  path: string;
  content: string;
  /** Content on disk when last read or written, to detect unsaved edits and outside changes. */
  disk: string;
}

export type DeployState =
  | { state: "idle"; message: string }
  | { state: "deploying"; message: string }
  | { state: "deployed"; message: string; plan: DeployPlan }
  | { state: "attention"; message: string; plan: DeployPlan }
  | { state: "waiting"; message: string }
  | { state: "blocked"; message: string }
  | { state: "failed"; message: string };

const AUTO_DEPLOY_DELAY_MS = 1200;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Why automatic deploys are paused for this robot project, or null when they can run. */
export function autoDeployBlocker(inspection: FtcProjectInspection | undefined, link: SdkLink): string | null {
  if (!inspection) return "Checking the FTC SDK project…";
  if (!inspection.isFtcProject) return inspection.problems.join(" ");
  if (inspection.incompatible.length) return inspection.incompatible.join(" ");
  if (!inspection.librariesReady) return "Automatic deploys start once the robot project has the libraries generated code needs.";
  if (!inspection.constantsClasses.some((item) => item.qualifiedName === link.constantsClass)) {
    return `Automatic deploys start once TeamCode has ${link.constantsClass}. Choose another constants class or add the Pedro Pathing setup.`;
  }
  return null;
}

export function useDesktop(project: Project, onLog: (line: string) => void) {
  const [sdk, setSdkState] = useState<SdkLink | null>(() => loadSdkLink(project));
  const [inspection, setInspection] = useState<FtcProjectInspection>();
  const [deployState, setDeployState] = useState<DeployState>({ state: "idle", message: "" });
  const [files, setFiles] = useState<JavaFile[]>([]);
  const [status, setStatus] = useState<ToolchainStatus>();
  const [busy, setBusy] = useState("");
  const folder = sdk?.folder ?? "";

  const task = useRef<RunningTask<unknown> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const cancelled = useRef(false);
  const deploying = useRef(false);
  const current = useRef(files);
  current.current = files;
  const latest = useRef({ project, sdk, inspection });
  latest.current = { project, sdk, inspection };

  const setSdk = (link: SdkLink | null) => {
    saveSdkLink(project.id, link);
    latest.current = { ...latest.current, sdk: link };
    setSdkState(link);
  };
  const target: JavaTarget | undefined = sdk ? { javaPackage: sdk.javaPackage, constantsClass: sdk.constantsClass } : undefined;

  const report = (event: RunEvent) => {
    if (event.event === "stdout" || event.event === "stderr") onLog(event.line);
    else if (event.event === "error") onLog(event.message);
  };
  const jobLog = (event: { event: string; message?: string; line?: string; received?: number }) => {
    if (event.event === "step" && event.message) onLog(event.message);
    if (event.event === "log" && event.line) onLog(event.line);
    if (event.event === "progress" && event.received !== undefined) onLog(`Downloaded ${(event.received / 1048576).toFixed(1)} MB`);
  };

  const refresh = async () => {
    if (isDesktop()) setStatus(await toolchainStatus());
  };

  const load = async (root = folder) => {
    if (!root || !isDesktop()) return;
    const fs = await import("@tauri-apps/plugin-fs");
    const found: JavaFile[] = [];
    const walk = async (relative: string) => {
      if (!(await fs.exists(joinPath(root, relative)))) return;
      for (const entry of await fs.readDir(joinPath(root, relative))) {
        if (entry.isSymlink) continue;
        const path = `${relative}/${entry.name}`;
        if (entry.isDirectory) await walk(path);
        else if (entry.name.endsWith(".java")) {
          const content = await fs.readTextFile(joinPath(root, path));
          found.push({ path, content, disk: content });
        }
      }
    };
    await walk("TeamCode/src");
    setFiles(found.sort((a, b) => a.path.localeCompare(b.path)));
  };

  const inspect = async (root = folder) => {
    if (!root || !isDesktop()) return undefined;
    const result = inspectFtcProject(await readFtcProject(root));
    latest.current = { ...latest.current, inspection: result };
    setInspection(result);
    return result;
  };

  useEffect(() => {
    void refresh().catch((error) => onLog(errorText(error)));
    void load().catch((error) => onLog(errorText(error)));
    void inspect().catch((error) => setDeployState({ state: "failed", message: `Could not read the FTC SDK project: ${errorText(error)}` }));
  }, [folder]);
  useEffect(() => () => {
    abort.current?.abort();
    void task.current?.cancel().catch(() => {});
  }, []);

  const perform = async <T,>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (locked.current) return undefined;
    locked.current = true;
    cancelled.current = false;
    setBusy(name);
    try {
      return await fn();
    } catch (error) {
      onLog(errorText(error));
      return undefined;
    } finally {
      task.current = null;
      locked.current = false;
      setBusy("");
    }
  };
  const track = async <T,>(running: Promise<RunningTask<T>>) => {
    const started = await running;
    task.current = started;
    if (cancelled.current) await started.cancel();
    return started.result;
  };
  const cancel = () => {
    cancelled.current = true;
    abort.current?.abort();
    void task.current?.cancel().catch((error) => onLog(errorText(error)));
  };

  const saveFiles = async () => {
    const fs = await import("@tauri-apps/plugin-fs");
    const changes = current.current.filter((file) => file.content !== file.disk);
    for (const file of changes) {
      const disk = await fs.readTextFile(joinPath(folder, file.path));
      if (disk !== file.disk) throw new Error(`${file.path} changed on disk. Reload it before saving.`);
    }
    for (const file of changes) {
      await fs.writeTextFile(joinPath(folder, file.path), file.content);
      setFiles((items) => items.map((item) => (item.path === file.path ? { ...item, disk: file.content } : item)));
    }
    if (changes.length) onLog(`Saved ${changes.length} Java ${changes.length === 1 ? "file" : "files"}.`);
  };

  /**
   * Generates the project's Java and writes it into the linked FTC SDK project.
   *
   * @param full re-read all of TeamCode first, which also refreshes the inspection
   * @param requireClean fail instead of leaving hand-edited generated files out of date
   */
  const deployNow = async ({ overwrite = [], full = false, requireClean = false, quiet = false }: { overwrite?: string[]; full?: boolean; requireClean?: boolean; quiet?: boolean } = {}) => {
    const link = latest.current.sdk;
    if (!link) throw new Error("Connect an FTC SDK project first.");
    if (deploying.current) throw new Error("A deploy is already running.");
    deploying.current = true;
    setDeployState({ state: "deploying", message: "Deploying code…" });
    try {
      let checked = latest.current.inspection;
      let existing: Map<string, string>;
      if (full || !checked) {
        const snapshot = await readFtcProject(link.folder);
        checked = inspectFtcProject(snapshot);
        latest.current = { ...latest.current, inspection: checked };
        setInspection(checked);
        existing = snapshot.files;
      } else {
        existing = await readDeployFiles(link.folder, javaPackageDirectory(link.javaPackage), link.deployedPaths);
      }
      if (!checked.isFtcProject) throw new Error(checked.problems.join(" "));

      const result = planDeploy(latest.current.project, link, existing, link.deployedPaths, overwrite, checked);
      if (!result.ok) {
        const count = result.diagnostics.filter((item) => item.severity === "error").length;
        const target = result.diagnostics.find((item) => item.code === "target.invalid");
        const message = target ? target.message : `Deploy is waiting until ${count === 1 ? "1 problem is" : `${count} problems are`} fixed.`;
        setDeployState({ state: "waiting", message });
        if (requireClean) throw new Error(message);
        return undefined;
      }
      const conflicts = result.writes.filter((entry) => entry.action === "conflict");
      if (requireClean && conflicts.length) {
        throw new Error(`Generated files were edited by hand: ${conflicts.map((entry) => entry.path).join(", ")}. Overwrite them in Robot, or delete their GENERATED header to keep your edits.`);
      }

      const applied = await applyDeployPlan(link.folder, result);
      const summary = describeDeploy(result);
      const changed = applied.written.length + applied.removed.length > 0;
      const pathsChanged = link.deployedPaths.join("\n") !== result.generatedPaths.join("\n");
      if (changed || pathsChanged || !link.lastDeploy) {
        setSdk({ ...link, deployedPaths: result.generatedPaths, lastDeploy: { at: new Date().toISOString(), summary } });
      }
      if (changed) {
        const writtenContent = new Map(result.writes.map((entry) => [entry.path, entry.content]));
        const removed = new Set(applied.removed);
        setFiles((items) => {
          const next = new Map(items.filter((item) => !removed.has(item.path)).map((item) => [item.path, item]));
          for (const path of applied.written) next.set(path, { path, content: writtenContent.get(path)!, disk: writtenContent.get(path)! });
          return [...next.values()].sort((a, b) => a.path.localeCompare(b.path));
        });
      }
      if (changed || !quiet) onLog(`Deployed to ${link.folder}: ${summary}.`);
      for (const removal of result.removals) if (!quiet) onLog(`Removed ${removal.path}: ${removal.reason}`);
      const needsAttention = conflicts.length > 0 || result.writes.some((entry) => entry.action === "skip");
      setDeployState(needsAttention ? { state: "attention", message: summary, plan: result } : { state: "deployed", message: summary, plan: result });
      return result;
    } catch (error) {
      setDeployState({ state: "failed", message: errorText(error) });
      throw error;
    } finally {
      deploying.current = false;
    }
  };

  // Automatic deploys: shortly after the project or the deploy settings change.
  const settingsKey = sdk ? JSON.stringify([sdk.folder, sdk.mode, sdk.javaPackage, sdk.constantsClass, sdk.programIds, sdk.removeOutdated]) : "";
  const blocker = useMemo(() => (sdk ? autoDeployBlocker(inspection, sdk) : null), [inspection, sdk]);
  useEffect(() => {
    if (!sdk || sdk.mode !== "auto" || !isDesktop()) return;
    if (blocker) {
      setDeployState((state) => (state.state === "deploying" ? state : { state: "blocked", message: blocker }));
      return;
    }
    if (hasErrors(validateProject(project))) {
      setDeployState({ state: "waiting", message: "Deploy is waiting until the project's problems are fixed." });
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      // Builds and other deploys finish first; they write the same files.
      if (locked.current || deploying.current) {
        timer = setTimeout(attempt, AUTO_DEPLOY_DELAY_MS);
        return;
      }
      void deployNow({ quiet: true }).catch((error) => onLog(`Automatic deploy failed: ${errorText(error)}`));
    };
    timer = setTimeout(attempt, AUTO_DEPLOY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [project, settingsKey, blocker]);

  const connect = () =>
    perform("Connecting FTC SDK project", async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, recursive: true, title: "Choose your FTC SDK project (the FtcRobotController folder)" });
      if (typeof selected !== "string") return;
      const result = inspectFtcProject(await readFtcProject(selected));
      if (!result.isFtcProject) throw new Error(result.problems.join(" "));
      if (current.current.some((file) => file.content !== file.disk) && !(await confirmAction("Discard unsaved Java edits and connect another folder?"))) return;
      const previous = latest.current.sdk;
      const fresh = newSdkLink(latest.current.project, selected, result);
      // Keep the team's choices when switching folders; deployed paths belong to the old folder.
      const link = previous
        ? { ...fresh, mode: previous.mode, javaPackage: previous.javaPackage, programIds: previous.programIds, removeOutdated: previous.removeOutdated, constantsClass: result.constantsClasses.some((item) => item.qualifiedName === previous.constantsClass) ? previous.constantsClass : fresh.constantsClass }
        : fresh;
      latest.current = { ...latest.current, inspection: result };
      setInspection(result);
      setDeployState({ state: "idle", message: "" });
      setSdk(link);
      onLog(`Connected ${selected}${result.sdkVersion ? ` (FTC SDK ${result.sdkVersion})` : ""}.`);
    });

  const disconnect = async () => {
    if (!(await confirmAction("Disconnect this FTC SDK project? Files already deployed stay where they are."))) return;
    setSdk(null);
    setInspection(undefined);
    setFiles([]);
    setDeployState({ state: "idle", message: "" });
  };

  const updateSdk = (changes: Partial<Pick<SdkLink, "mode" | "javaPackage" | "constantsClass" | "programIds" | "removeOutdated">>) => {
    const link = latest.current.sdk;
    if (link) setSdk({ ...link, ...changes });
  };

  const create = () =>
    perform("Creating FTC project", async () => {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const destination = await save({ title: "Choose a new, empty robot project folder", defaultPath: project.name.replace(/[^\w -]/g, "") });
      if (!destination) return;
      const result = await track(createRobotProject(destination, jobLog));
      const checked = inspectFtcProject(await readFtcProject(result));
      latest.current = { ...latest.current, inspection: checked };
      setInspection(checked);
      setSdk(newSdkLink(latest.current.project, result, checked));
    });

  const addLibraries = (includePedroSetup: boolean) =>
    perform("Adding libraries", async () => {
      const link = latest.current.sdk;
      if (!link) throw new Error("Connect an FTC SDK project first.");
      const changes: SdkChange[] = await track(addSdkLibraries(link.folder, includePedroSetup, jobLog));
      for (const change of changes) {
        if (change.action !== "kept" || change.note) onLog(`${change.action === "kept" ? "Kept" : change.action === "created" ? "Added" : "Updated"} ${change.path}${change.note ? `: ${change.note}` : ""}`);
      }
      await inspect(link.folder);
      await load(link.folder);
      onLog("Sync the Gradle project in Android Studio to download the new libraries.");
      return changes;
    });

  const install = (accepted: boolean) =>
    perform("Installing build tools", async () => {
      setStatus(await track(installToolchain(accepted, jobLog)));
    });

  const sync = async () => {
    if (!folder) throw new Error("Connect or create an FTC SDK project first.");
    await saveFiles();
    await deployNow({ full: true, requireClean: true });
  };

  const run = (kind: keyof typeof GRADLE_TASKS, host = "192.168.43.1") =>
    perform(kind === "deploy" ? "Installing on the robot" : "Building", async () => {
      await sync();
      if (kind === "deploy") {
        const connected = await track(adbConnect(folder, `${host}:5555`, report));
        if (connected.code !== 0 || connected.cancelled || cancelled.current) throw new Error("ADB connection did not complete.");
      }
      if (cancelled.current) return;
      const result = await track(gradle(folder, GRADLE_TASKS[kind], report));
      onLog(result.cancelled ? "Build cancelled." : result.code === 0 ? "BUILD SUCCESSFUL" : `BUILD FAILED (exit ${result.code})`);
    });

  const launch = async (): Promise<DesktopSimulator | undefined> =>
    perform("Starting simulator", async () => {
      abort.current = new AbortController();
      await sync();
      if (cancelled.current) return undefined;
      return startSimulator(folder, { signal: abort.current.signal, onEvent: report });
    });

  const edit = (path: string, content: string) => setFiles((items) => items.map((file) => (file.path === path ? { ...file, content } : file)));

  const reloadFile = (path: string) =>
    perform("Reloading file", async () => {
      const file = current.current.find((item) => item.path === path);
      if (file && file.content !== file.disk && !(await confirmAction("Discard the unsaved edits and reload this file?"))) return;
      const fs = await import("@tauri-apps/plugin-fs");
      const content = await fs.readTextFile(joinPath(folder, path));
      setFiles((items) => items.map((item) => (item.path === path ? { ...item, content, disk: content } : item)));
    });

  useEffect(() => {
    if (!folder) return;
    const check = async () => {
      const fs = await import("@tauri-apps/plugin-fs");
      for (const file of current.current) {
        try {
          const disk = await fs.readTextFile(joinPath(folder, file.path));
          if (disk !== file.disk) onLog(`${file.path} changed on disk. Use Reload file to review it.`);
        } catch {
          // A deleted file is reported when it is saved or reloaded.
        }
      }
      // Returning to the app refreshes what the connection panel knows about the project.
      void inspect(folder).catch(() => {});
    };
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [folder]);

  return {
    folder,
    files,
    status,
    busy,
    sdk,
    target,
    inspection,
    deployState,
    autoDeployBlocker: blocker,
    refresh,
    link: connect,
    connect,
    disconnect,
    updateSdk,
    inspect: () => perform("Checking FTC SDK project", () => inspect()),
    deploy: (overwrite: string[] = []) => perform("Deploying code", () => deployNow({ full: true, overwrite })),
    addLibraries,
    create,
    install,
    cancel,
    run,
    launch,
    edit,
    reloadFile,
    save: () => perform("Saving Java", saveFiles),
    sync: () => perform("Deploying code", sync),
    eject: (path: string) => {
      const file = files.find((item) => item.path === path);
      if (file && ownershipOf(file.content) !== "team") edit(path, file.content.split("\n").slice(2).join("\n"));
    },
  };
}
