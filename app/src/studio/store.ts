import { openDB } from "idb";
import { BRAND } from "../brand";
import { createAutonomous, createProject, importVisualizer, isVersion1Project, migrateVersion1, parseProject, type Project } from "../core";
import { isDesktop } from "../desktop/backend";
import { createProjectStore } from "../storage/projectStore";

const db = () => openDB("ftc-studio-projects", 1, { upgrade(database) { database.createObjectStore("projects", { keyPath: "id" }); } });
const recoveryKey = "studio-v2-recovery";
const path = (id: string) => {
  if (!/^[\w-]+$/.test(id)) throw new Error("Invalid project identifier.");
  return `projects-v2/${id}.${BRAND.projectExtension}`;
};
export function recovery(): Record<string, Project> {
  try { return Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem(recoveryKey) ?? "{}")).map(([id, value]) => [id, parseProject(value)])); } catch { return {}; }
}
export function stage(project: Project) { localStorage.setItem(recoveryKey, JSON.stringify({ ...recovery(), [project.id]: project })); }
export async function saveProject(project: Project) {
  parseProject(project);
  if (isDesktop()) {
    const fs = await import("@tauri-apps/plugin-fs");
    const opts = { baseDir: fs.BaseDirectory.AppData };
    await fs.mkdir("projects-v2", { ...opts, recursive: true });
    await fs.writeTextFile(`${path(project.id)}.tmp`, JSON.stringify(project, null, 2), opts);
    await fs.rename(`${path(project.id)}.tmp`, path(project.id), { oldPathBaseDir: opts.baseDir, newPathBaseDir: opts.baseDir });
  } else await (await db()).put("projects", project);
  const drafts = recovery();
  if (drafts[project.id]?.updatedAt === project.updatedAt) { delete drafts[project.id]; localStorage.setItem(recoveryKey, JSON.stringify(drafts)); }
}
export async function deleteProject(id: string) {
  if (isDesktop()) { const fs = await import("@tauri-apps/plugin-fs"); await fs.remove(path(id), { baseDir: fs.BaseDirectory.AppData }); }
  else await (await db()).delete("projects", id);
  const drafts = recovery(); delete drafts[id]; localStorage.setItem(recoveryKey, JSON.stringify(drafts));
}
export async function listProjects(): Promise<{ projects: Project[]; warnings: string[] }> {
  const warnings: string[] = [];
  const projects: Project[] = [];
  if (isDesktop()) {
    const fs = await import("@tauri-apps/plugin-fs"); const opts = { baseDir: fs.BaseDirectory.AppData };
    await fs.mkdir("projects-v2", { ...opts, recursive: true });
    for (const entry of await fs.readDir("projects-v2", opts)) {
      if (!entry.name.endsWith(`.${BRAND.projectExtension}`)) continue;
      try { projects.push(parseProject(JSON.parse(await fs.readTextFile(`projects-v2/${entry.name}`, opts)))); }
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
  if (filename.endsWith(".pp")) {
    const imported = importVisualizer(text);
    const project = createProject(filename.replace(/\.pp$/, ""));
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
