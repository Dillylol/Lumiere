/**
 * Small, dependency-free helpers for reading Java source: enough structure to find annotations,
 * declarations, and matching brackets without a full parser.
 */

/**
 * Returns the source with comments and the contents of string, text-block, and character literals
 * replaced by spaces. Offsets and line breaks are unchanged, so matches in the masked text point at
 * the same places in the original.
 */
export function maskJava(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number) => {
    for (let index = from; index < to; index += 1) if (out[index] !== "\n" && out[index] !== "\r") out[index] = " ";
  };
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index);
      const stop = end < 0 ? source.length : end;
      blank(index, stop);
      index = stop;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end < 0 ? source.length : end + 2;
      blank(index, stop);
      index = stop;
    } else if (source.startsWith('"""', index)) {
      const end = source.indexOf('"""', index + 3);
      const stop = end < 0 ? source.length : end;
      blank(index + 3, stop);
      index = end < 0 ? source.length : stop + 3;
    } else if (char === '"' || char === "'") {
      let stop = index + 1;
      while (stop < source.length && source[stop] !== char && source[stop] !== "\n") stop += source[stop] === "\\" ? 2 : 1;
      blank(index + 1, Math.min(stop, source.length));
      index = stop + 1;
    } else {
      index += 1;
    }
  }
  return out.join("");
}

const OPEN: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
const CLOSE = new Set(Object.values(OPEN));

/**
 * In masked source, the index just past the first `terminator` found at bracket depth zero from
 * `start`, or -1 when the brackets never balance.
 */
export function scanTo(masked: string, start: number, terminator: string): number {
  let depth = 0;
  for (let index = start; index < masked.length; index += 1) {
    const char = masked[index];
    if (depth === 0 && char === terminator) return index + 1;
    if (char in OPEN) depth += 1;
    else if (CLOSE.has(char)) {
      depth -= 1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/** Brace depth (`{` nesting) at each offset of masked source. */
export function braceDepths(masked: string): Uint16Array {
  const depths = new Uint16Array(masked.length + 1);
  let depth = 0;
  for (let index = 0; index < masked.length; index += 1) {
    depths[index] = depth;
    if (masked[index] === "{") depth += 1;
    else if (masked[index] === "}") depth = Math.max(0, depth - 1);
  }
  depths[masked.length] = depth;
  return depths;
}

/** 1-based line number of an offset. */
export function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < source.length; index += 1) if (source[index] === "\n") line += 1;
  return line;
}

/** Decodes the body of a Java string literal (without its quotes). */
export function unescapeJavaString(body: string): string {
  return body.replace(/\\(u+[0-9a-fA-F]{4}|[0-7]{1,3}|.)/g, (_, escape: string) => {
    if (escape[0] === "u") return String.fromCharCode(parseInt(escape.slice(-4), 16));
    if (/^[0-7]/.test(escape)) return String.fromCharCode(parseInt(escape, 8));
    const simple: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", s: " " };
    return simple[escape] ?? escape;
  });
}

/** The package declared by a compilation unit, or "" for the default package. */
export function packageOf(source: string): string {
  const masked = maskJava(source);
  return /^\s*package\s+([\w.]+)\s*;/m.exec(masked)?.[1] ?? "";
}

/** Fully qualified names imported by single-type imports. */
export function importsOf(source: string): string[] {
  const masked = maskJava(source);
  return [...masked.matchAll(/^\s*import\s+(?!static\b)([\w.]+)\s*;/gm)].map((match) => match[1]);
}

/** Adds single-type imports after the last import, or after the package declaration. */
export function addImports(source: string, qualifiedNames: string[]): string {
  if (!qualifiedNames.length) return source;
  const masked = maskJava(source);
  const imports = [...masked.matchAll(/^[ \t]*import\s+[\w.*]+\s*;[ \t]*$/gm)];
  const lines = qualifiedNames.map((name) => `import ${name};`).join("\n");
  if (imports.length) {
    const last = imports[imports.length - 1];
    const at = last.index + last[0].length;
    return `${source.slice(0, at)}\n${lines}${source.slice(at)}`;
  }
  const packageLine = /^[ \t]*package\s+[\w.]+\s*;[ \t]*$/m.exec(masked);
  const at = packageLine ? packageLine.index + packageLine[0].length : 0;
  return `${source.slice(0, at)}\n\n${lines}\n${source.slice(at)}`;
}
