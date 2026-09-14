/**
 * Generated files start with a two-line header. The checksum covers everything after the header, so
 * an edited file can be told apart from one that is safe to regenerate. Removing the header hands
 * the file to the team: it will no longer be treated as generated.
 */

const MARKER = "// GENERATED FILE:";
const CHECKSUM = "// checksum: ";

/** 64-bit FNV-1a over UTF-16 code units, as 16 hex digits. Detects edits; it is not a security hash. */
export function checksum(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export function withHeader(body: string, projectName: string, appName: string): string {
  const safeName = projectName.replace(/[\r\n]+/g, " ");
  return `${MARKER} edit the "${safeName}" project in ${appName} instead. To keep hand edits, delete these two lines.\n${CHECKSUM}${checksum(body)}\n${body}`;
}

export type Ownership =
  /** Generated and unchanged: safe to overwrite. */
  | "generated"
  /** Generated, but edited since: overwriting would lose the edits. */
  | "modified"
  /** No header: written or taken over by the team. Never overwrite. */
  | "team";

export function ownershipOf(content: string): Ownership {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(MARKER)) return "team";
  const firstBreak = normalized.indexOf("\n");
  const secondBreak = normalized.indexOf("\n", firstBreak + 1);
  if (firstBreak < 0 || secondBreak < 0) return "modified";
  const checksumLine = normalized.slice(firstBreak + 1, secondBreak);
  if (!checksumLine.startsWith(CHECKSUM)) return "modified";
  const expected = checksumLine.slice(CHECKSUM.length).trim();
  return checksum(normalized.slice(secondBreak + 1)) === expected ? "generated" : "modified";
}

export interface WritePlanEntry {
  path: string;
  content: string;
  action: "create" | "update" | "unchanged" | "conflict" | "skip";
  reason?: string;
}

/**
 * Decides what to do with each generated file given what is already on disk.
 *
 * - **create:** nothing is on disk.
 * - **update:** the file on disk is generated and unedited.
 * - **unchanged:** the file on disk already has identical content.
 * - **conflict:** the file on disk is generated but was edited. Ask before overwriting.
 * - **skip:** the file on disk has no header, so the team owns it.
 */
export function planWrites(files: { path: string; content: string }[], existing: Map<string, string>): WritePlanEntry[] {
  return files.map((file) => {
    const current = existing.get(file.path);
    if (current === undefined) return { ...file, action: "create" };
    if (current.replace(/\r\n/g, "\n") === file.content) return { ...file, action: "unchanged" };
    switch (ownershipOf(current)) {
      case "generated": return { ...file, action: "update" };
      case "modified": return { ...file, action: "conflict", reason: "This generated file was edited by hand." };
      case "team": return { ...file, action: "skip", reason: "This file is not generated, so it was left as it is." };
    }
  });
}
