import { openDB } from "idb";
import { BRAND } from "../brand";
import { PROJECT_VERSION, createAutonomous, createProject, importVisualizer, isVersion1Project, migrateVersion1, parseProject, type Project } from "../core";
import { isDesktop } from "../desktop/backend";
import { createProjectStore } from "../storage/projectStore";

const db = () => openDB("ftc-studio-projects", 1, { upgrade(database) { database.createObjectStore("projects", { keyPath: "id" }); } });
const recoveryKey = "studio-v2-recovery";
const path = (id: string) => {
  if (!/^[\w-]+$/.test(id)) throw new Error("Invalid project identifier.");
  return `projects-v2/${id}.${BRAND.projectExtension}`;
};
/** Every staged draft as stored, including any that no longer parse. */
function storedDrafts(): Record<string, unknown> {
  try {
    const drafts: unknown = JSON.parse(localStorage.getItem(recoveryKey) ?? "{}");
    return drafts && typeof drafts === "object" && !Array.isArray(drafts) ? drafts as Record<string, unknown> : {};
  } catch { return {}; }
}
/** The drafts that parse. One unreadable draft never hides or erases the others; it stays in storage untouched. */
export function recovery(): Record<string, Project> {
  const drafts: Record<string, Project> = {};
  for (const [id, value] of Object.entries(storedDrafts())) {
    try { drafts[id] = parseProject(value); } catch { /* Left in storage so it is not lost. */ }
  }
  return drafts;
}
export function stage(project: Project) { localStorage.setItem(recoveryKey, JSON.stringify({ ...storedDrafts(), [project.id]: project })); }
export async function saveProject(project: Project) {
  parseProject(project);
  if (isDesktop()) {
    const fs = await import("@tauri-apps/plugin-fs");
    const opts = { baseDir: fs.BaseDirectory.AppData };
    await fs.mkdir("projects-v2", { ...opts, recursive: true });
    await fs.writeTextFile(`${path(project.id)}.tmp`, JSON.stringify(project, null, 2), opts);
    await fs.rename(`${path(project.id)}.tmp`, path(project.id), { oldPathBaseDir: opts.baseDir, newPathBaseDir: opts.baseDir });
  } else await (await db()).put("projects", project);
  const drafts = storedDrafts();
  if ((drafts[project.id] as { updatedAt?: unknown } | undefined)?.updatedAt === project.updatedAt) { delete drafts[project.id]; localStorage.setItem(recoveryKey, JSON.stringify(drafts)); }
}
export async function deleteProject(id: string) {
  if (isDesktop()) { const fs = await import("@tauri-apps/plugin-fs"); await fs.remove(path(id), { baseDir: fs.BaseDirectory.AppData }); }
  else await (await db()).delete("projects", id);
  const drafts = storedDrafts(); delete drafts[id]; localStorage.setItem(recoveryKey, JSON.stringify(drafts));
}

const DEFAULT_ROBOT_HOST = "192.168.43.1";
const robotHostKey = (projectId: string) => `lumiere-robot-host:${projectId}`;
/** The Control Hub address last used with this project on this computer. */
export function robotHost(projectId: string): string {
  try { return localStorage.getItem(robotHostKey(projectId)) || DEFAULT_ROBOT_HOST; } catch { return DEFAULT_ROBOT_HOST; }
}
export function saveRobotHost(projectId: string, host: string) {
  try {
    if (host.trim()) localStorage.setItem(robotHostKey(projectId), host.trim());
  } catch { /* The address then falls back to the default next time. */ }
}
/**
 * The backup file name for a stored project that loading will upgrade, such as `Robot.ftcproj.v3.bak`
 * for a version 3 file, or null when the project is already current.
 */
export function backupName(fileName: string, stored: unknown): string | null {
  const version = (stored as { version?: unknown } | null)?.version;
  return typeof version === "number" && version >= 2 && version < PROJECT_VERSION ? `${fileName}.v${version}.bak` : null;
}

export async function listProjects(): Promise<{ projects: Project[]; warnings: string[] }> {
  const warnings: string[] = [];
  const projects: Project[] = [];
  if (isDesktop()) {
    const fs = await import("@tauri-apps/plugin-fs"); const opts = { baseDir: fs.BaseDirectory.AppData };
    await fs.mkdir("projects-v2", { ...opts, recursive: true });
    for (const entry of await fs.readDir("projects-v2", opts)) {
      if (!entry.name.endsWith(`.${BRAND.projectExtension}`)) continue;
      try {
        const text = await fs.readTextFile(`projects-v2/${entry.name}`, opts);
        const stored: unknown = JSON.parse(text);
        // Saving rewrites an older file in the current version, which older Lumière versions cannot open.
        // Keep the original beside it (such as `.v3.bak`) until then; once saved, the file is current.
        const backup = backupName(entry.name, stored);
        if (backup) await fs.writeTextFile(`projects-v2/${backup}`, text, opts);
        projects.push(parseProject(stored));
      }
      catch { warnings.push(`Could not read ${entry.name}. The original file is still available.`); }
    }
  } else projects.push(...(await (await db()).getAll("projects")).map(parseProject));
  if (!localStorage.getItem("studio-v2-migrated")) {
    for (const old of await createProjectStore().list()) {
      const migrated = migrateVersion1(old);
      migrated.project.id = `migrated_${old.id}`;
      if (!projects.some((p) => p.id === migrated.project.id)) { await saveProject(migrated.project); projects.push(migrated.project); }
      warnings.push(...migrated.warnings);
    }
    localStorage.setItem("studio-v2-migrated", "true");
  }
  const map = new Map(projects.map((p) => [p.id, p]));
  for (const draft of Object.values(recovery())) if (!map.has(draft.id) || map.get(draft.id)!.updatedAt <= draft.updatedAt) map.set(draft.id, draft);
  return { projects: [...map.values()].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)), warnings };
}
export function parseImport(text: string, filename: string) {
  const value: unknown = JSON.parse(text);
  if (filename.toLowerCase().endsWith(".pp")) {
    const project = createProject(filename.slice(0, -3));
    const imported = importVisualizer(text, { robot: project.robot });
    project.programs.push({ ...createAutonomous("Imported Auto"), start: imported.start, paths: imported.paths, routine: imported.routine });
    return { project: parseProject(project), warnings: imported.warnings };
  }
  if (isVersion1Project(value)) return migrateVersion1(value);
  return { project: parseProject(value), warnings: [] };
}
/** Project files people save and share. Older `.ftcproj` exports still import: the importer reads the content, not the name. */
export const PROJECT_FILE_TYPES = `.${BRAND.projectExtension},.ftcproj,.jules,.pp,.json`;
export function exportProject(project: Project) { download(`${project.name}.${BRAND.projectExtension}`, JSON.stringify(project, null, 2)); }
export function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Asks before a destructive action: a native dialog on the desktop, the browser's prompt on the web. */
export async function confirmAction(message: string): Promise<boolean> {
  if (!isDesktop()) return window.confirm(message);
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(message, { kind: "warning" });
}
