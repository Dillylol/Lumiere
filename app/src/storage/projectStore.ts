import { BRAND } from "../brand";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { cloneProject, parseProject, type JulesProjectV1 } from "../models/project";

export interface ProjectStore {
  readonly kind: "web" | "desktop";
  list(): Promise<JulesProjectV1[]>;
  get(id: string): Promise<JulesProjectV1 | undefined>;
  save(project: JulesProjectV1): Promise<void>;
  delete(id: string): Promise<void>;
  duplicate(project: JulesProjectV1): Promise<JulesProjectV1>;
}

interface JulesDatabase extends DBSchema {
  projects: {
    key: string;
    value: JulesProjectV1;
    indexes: { "by-updated": string };
  };
}

class IndexedDbProjectStore implements ProjectStore {
  readonly kind = "web" as const;
  private database?: IDBPDatabase<JulesDatabase>;

  private async db() {
    this.database ??= await openDB<JulesDatabase>("jules-projects", 1, {
      upgrade(database) {
        const projects = database.createObjectStore("projects", { keyPath: "id" });
        projects.createIndex("by-updated", "updatedAt");
      },
    });
    return this.database;
  }

  async list() {
    const values = await (await this.db()).getAll("projects");
    return values.map(parseProject).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string) {
    const value = await (await this.db()).get("projects", id);
    return value ? parseProject(value) : undefined;
  }

  async save(project: JulesProjectV1) {
    await (await this.db()).put("projects", parseProject(project));
  }

  async delete(id: string) {
    await (await this.db()).delete("projects", id);
  }

  async duplicate(project: JulesProjectV1) {
    const copy = cloneProject(project);
    await this.save(copy);
    return copy;
  }
}

class TauriProjectStore implements ProjectStore {
  readonly kind = "desktop" as const;
  private readonly directory = "projects";

  private async fs() {
    return import("@tauri-apps/plugin-fs");
  }

  private async ensureDirectory() {
    const { BaseDirectory, exists, mkdir } = await this.fs();
    if (!(await exists(this.directory, { baseDir: BaseDirectory.AppData }))) {
      await mkdir(this.directory, { baseDir: BaseDirectory.AppData, recursive: true });
    }
  }

  private path(id: string) {
    return `${this.directory}/${id}.jules`;
  }

  async list() {
    await this.ensureDirectory();
    const { BaseDirectory, readDir, readTextFile } = await this.fs();
    const entries = await readDir(this.directory, { baseDir: BaseDirectory.AppData });
    const projects: JulesProjectV1[] = [];
    for (const entry of entries.filter((item) => item.isFile && item.name.endsWith(".jules"))) {
      try {
        projects.push(parseProject(JSON.parse(await readTextFile(`${this.directory}/${entry.name}`, { baseDir: BaseDirectory.AppData }))));
      } catch (error) {
        console.warn(`Could not load ${entry.name}`, error);
      }
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string) {
    await this.ensureDirectory();
    const { BaseDirectory, exists, readTextFile } = await this.fs();
    if (!(await exists(this.path(id), { baseDir: BaseDirectory.AppData }))) return undefined;
    return parseProject(JSON.parse(await readTextFile(this.path(id), { baseDir: BaseDirectory.AppData })));
  }

  async save(project: JulesProjectV1) {
    await this.ensureDirectory();
    const { BaseDirectory, rename, writeTextFile } = await this.fs();
    const target = this.path(project.id);
    const temporary = `${target}.tmp`;
    await writeTextFile(temporary, JSON.stringify(parseProject(project), null, 2), { baseDir: BaseDirectory.AppData });
    await rename(temporary, target, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData });
  }

  async delete(id: string) {
    const { BaseDirectory, exists, remove } = await this.fs();
    const target = this.path(id);
    if (await exists(target, { baseDir: BaseDirectory.AppData })) await remove(target, { baseDir: BaseDirectory.AppData });
  }

  async duplicate(project: JulesProjectV1) {
    const copy = cloneProject(project);
    await this.save(copy);
    return copy;
  }
}

export const isTauri = () => "__TAURI_INTERNALS__" in window;
export const createProjectStore = (): ProjectStore => isTauri() ? new TauriProjectStore() : new IndexedDbProjectStore();

export async function exportProject(project: JulesProjectV1) {
  const serialized = JSON.stringify(parseProject(project), null, 2);
  if (isTauri()) {
    const [{ save }, { writeTextFile }] = await Promise.all([import("@tauri-apps/plugin-dialog"), import("@tauri-apps/plugin-fs")]);
    const path = await save({ defaultPath: `${project.name}.${BRAND.projectExtension}`, filters: [{ name: `${BRAND.name} project`, extensions: [BRAND.projectExtension] }] });
    if (path) await writeTextFile(path, serialized);
    return;
  }
  const blob = new Blob([serialized], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${project.name}.${BRAND.projectExtension}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function importProjectFromFile(): Promise<JulesProjectV1 | undefined> {
  if (isTauri()) {
    const [{ open }, { readTextFile }] = await Promise.all([import("@tauri-apps/plugin-dialog"), import("@tauri-apps/plugin-fs")]);
    const path = await open({ multiple: false, directory: false, filters: [{ name: `${BRAND.name} project`, extensions: [BRAND.projectExtension, "jules", "json"] }] });
    if (!path || Array.isArray(path)) return undefined;
    return parseProject(JSON.parse(await readTextFile(path)));
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `.${BRAND.projectExtension},.jules,.json,application/json`;
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        resolve(file ? parseProject(JSON.parse(await file.text())) : undefined);
      } catch (error) {
        reject(error);
      }
    };
    input.oncancel = () => resolve(undefined);
    input.click();
  });
}

export async function migrateLegacyPrograms(store: ProjectStore, createLegacyProject: (name: string, code: string) => JulesProjectV1) {
  if (localStorage.getItem("jules-v1-migrated") === "true") return;
  try {
    const raw = localStorage.getItem("jules_programs");
    if (raw) {
      const programs = JSON.parse(raw) as Array<{ name?: string; code?: string }>;
      for (const legacy of programs) {
        if (legacy.code) await store.save(createLegacyProject(legacy.name || "Imported program", legacy.code));
      }
    }
    localStorage.setItem("jules-v1-migrated", "true");
  } catch (error) {
    console.warn("Legacy project migration was skipped", error);
  }
}

