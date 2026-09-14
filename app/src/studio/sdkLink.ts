/**
 * The FTC SDK project a studio project deploys into, and how. Kept per computer in local storage, not
 * in the project file: folder paths are specific to this computer and must not travel with an
 * exported `.lum` project file.
 */
import { checkJavaTarget, defaultDeploySettings, type DeploySettings, type FtcProjectInspection, type Project } from "../core";

export type DeployMode = "auto" | "manual";

export interface SdkLink extends DeploySettings {
  version: 1;
  folder: string;
  mode: DeployMode;
  /** Paths the last deploy generated, so renamed programs and package changes are cleaned up. */
  deployedPaths: string[];
  lastDeploy?: { at: string; summary: string };
}

const key = (projectId: string) => `studio-sdk-link-${projectId}`;
const legacyKey = (projectId: string) => `studio-folder-${projectId}`;

export function newSdkLink(project: Project, folder: string, inspection?: FtcProjectInspection): SdkLink {
  return { version: 1, folder, mode: "auto", deployedPaths: [], ...defaultDeploySettings(project, inspection) };
}

function isLink(value: unknown): value is SdkLink {
  if (typeof value !== "object" || value === null) return false;
  const link = value as Partial<SdkLink>;
  return (
    link.version === 1 &&
    typeof link.folder === "string" &&
    link.folder.length > 0 &&
    typeof link.javaPackage === "string" &&
    typeof link.constantsClass === "string" &&
    (link.mode === "auto" || link.mode === "manual") &&
    typeof link.removeOutdated === "boolean" &&
    (link.programIds === null || (Array.isArray(link.programIds) && link.programIds.every((id) => typeof id === "string"))) &&
    Array.isArray(link.deployedPaths) &&
    link.deployedPaths.every((path) => typeof path === "string") &&
    checkJavaTarget({ javaPackage: link.javaPackage, constantsClass: link.constantsClass }) === null
  );
}

export function loadSdkLink(project: Project): SdkLink | null {
  try {
    const stored = localStorage.getItem(key(project.id));
    if (stored) {
      const value: unknown = JSON.parse(stored);
      if (isLink(value)) return value;
    }
    // Earlier versions stored only the folder; they generated files by hand, so keep deploys manual.
    const folder = localStorage.getItem(legacyKey(project.id));
    if (folder) return { ...newSdkLink(project, folder), mode: "manual" };
  } catch {
    // Unreadable storage behaves like no link.
  }
  return null;
}

export function saveSdkLink(projectId: string, link: SdkLink | null) {
  try {
    if (link) localStorage.setItem(key(projectId), JSON.stringify(link));
    else localStorage.removeItem(key(projectId));
    localStorage.removeItem(legacyKey(projectId));
  } catch {
    // The link still works for this session.
  }
}
