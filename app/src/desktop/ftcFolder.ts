/**
 * Reads a linked FTC SDK project and applies deploy plans to it, through the fs plugin. The app can
 * only reach folders the user picked or created, and those stay reachable after a restart.
 */
import { INSPECTED_FILES, INSPECTED_JAVA_ROOT, type DeployPlan, type FtcProjectSnapshot } from "../core";

type Fs = typeof import("@tauri-apps/plugin-fs");
const loadFs = (): Promise<Fs> => import("@tauri-apps/plugin-fs");

export const joinPath = (folder: string, relative: string) => `${folder.replace(/[\\/]+$/, "")}/${relative}`;

async function javaFiles(fs: Fs, folder: string, relative: string, found: Map<string, string>) {
  if (!(await fs.exists(joinPath(folder, relative)))) return;
  for (const entry of await fs.readDir(joinPath(folder, relative))) {
    if (entry.isSymlink) continue;
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory) await javaFiles(fs, folder, path, found);
    else if (entry.name.endsWith(".java")) found.set(path, await fs.readTextFile(joinPath(folder, path)));
  }
}

/** Reads the build files and TeamCode sources that `inspectFtcProject` and `planDeploy` need. */
export async function readFtcProject(folder: string): Promise<FtcProjectSnapshot> {
  const fs = await loadFs();
  const files = new Map<string, string>();
  for (const path of INSPECTED_FILES) {
    if (await fs.exists(joinPath(folder, path))) files.set(path, await fs.readTextFile(joinPath(folder, path)));
  }
  await javaFiles(fs, folder, INSPECTED_JAVA_ROOT, files);
  return { files };
}

/**
 * Reads only what a deploy compares against: the generated package folder and the files the last
 * deploy wrote. Much faster than reading all of TeamCode after every change.
 */
export async function readDeployFiles(folder: string, directory: string, previousPaths: string[]): Promise<Map<string, string>> {
  const fs = await loadFs();
  const files = new Map<string, string>();
  if (await fs.exists(joinPath(folder, directory))) {
    for (const entry of await fs.readDir(joinPath(folder, directory))) {
      if (!entry.isDirectory && !entry.isSymlink && entry.name.endsWith(".java")) {
        files.set(`${directory}/${entry.name}`, await fs.readTextFile(joinPath(folder, `${directory}/${entry.name}`)));
      }
    }
  }
  for (const path of previousPaths) {
    if (!files.has(path) && (await fs.exists(joinPath(folder, path)))) files.set(path, await fs.readTextFile(joinPath(folder, path)));
  }
  return files;
}

export interface AppliedDeploy {
  written: string[];
  removed: string[];
}

/**
 * Writes the plan's created and updated files and removes outdated ones. Each file is written to a
 * temporary name first and then renamed, so Android Studio never compiles a half-written file.
 */
export async function applyDeployPlan(folder: string, plan: DeployPlan): Promise<AppliedDeploy> {
  const fs = await loadFs();
  const written: string[] = [];
  const removed: string[] = [];
  for (const entry of plan.writes) {
    if (entry.action !== "create" && entry.action !== "update") continue;
    const target = joinPath(folder, entry.path);
    await fs.mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
    await fs.writeTextFile(`${target}.tmp`, entry.content);
    await fs.rename(`${target}.tmp`, target);
    written.push(entry.path);
  }
  const emptied = new Set<string>();
  for (const removal of plan.removals) {
    const target = joinPath(folder, removal.path);
    if (await fs.exists(target)) await fs.remove(target);
    removed.push(removal.path);
    emptied.add(removal.path.slice(0, removal.path.lastIndexOf("/")));
  }
  // Package folders left empty by removed files go too, but never the Java source root itself.
  for (let directory of emptied) {
    while (directory.startsWith(`${INSPECTED_JAVA_ROOT}/`)) {
      const path = joinPath(folder, directory);
      if (!(await fs.exists(path)) || (await fs.readDir(path)).length > 0) break;
      await fs.remove(path);
      directory = directory.slice(0, directory.lastIndexOf("/"));
    }
  }
  return { written, removed };
}
