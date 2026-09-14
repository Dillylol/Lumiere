/**
 * Code completion for the Java editor without a language server. It understands enough to complete
 * members after `name.` (declared variables, OpMode fields, static classes, and chains such as
 * `PoseFactory.degrees().of(...)`) and offers known classes, local names, and snippets elsewhere.
 */
import { maskJava, packageOf } from "../java/source";
import { CLASSES, HINTS, SNIPPETS, type JavaHint } from "./hints";

export type CompletionKind = "method" | "field" | "class" | "variable" | "snippet";

export interface CompletionItem {
  label: string;
  kind: CompletionKind;
  /** Text to insert. When `snippet` is true it uses `${1:name}` tab stops. */
  insertText: string;
  snippet: boolean;
  /** Signature, such as `void setPower(double power)`. */
  detail: string;
  documentation?: string;
  docs?: string;
  /** Fully qualified imports to add when the item is accepted. */
  imports: string[];
}

export interface CompletionResult {
  /** Offset where the word being completed starts; replace from here to the cursor. */
  from: number;
  items: CompletionItem[];
}

/** Supertypes, so members declared higher up are offered on subtypes. */
const SUPERTYPES: Record<string, string[]> = {
  LinearOpMode: ["OpMode"],
  DcMotorEx: ["DcMotor"],
  DcMotor: ["DcMotorSimple"],
  CRServo: ["DcMotorSimple"],
  CommandBuilder: ["Command"],
};

const IMPLICIT_OPMODE = new Set(["OpMode", "LinearOpMode"]);
const simpleName = (qualified: string) => qualified.slice(qualified.lastIndexOf(".") + 1);
const byOwner = new Map<string, JavaHint[]>();
for (const hint of HINTS) {
  const owner = simpleName(hint.owner);
  byOwner.set(owner, [...(byOwner.get(owner) ?? []), hint]);
}

function membersOf(type: string): JavaHint[] {
  const seen = new Set<string>();
  const result: JavaHint[] = [];
  const visit = (name: string) => {
    for (const hint of byOwner.get(name) ?? []) {
      const key = `${hint.name}(${hint.params.length})`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(hint);
      }
    }
    for (const parent of SUPERTYPES[name] ?? []) visit(parent);
  };
  visit(type);
  return result;
}

function signature(hint: JavaHint): string {
  const params = hint.params.map((param) => `${param.type} ${param.name}`).join(", ");
  const isField = hint.kind === "field" || hint.kind === "staticField";
  return isField ? `${hint.returns} ${hint.name}` : `${hint.returns} ${hint.name}(${params})`;
}

function toItem(hint: JavaHint): CompletionItem {
  const isField = hint.kind === "field" || hint.kind === "staticField";
  const insertText = isField
    ? hint.name
    : `${hint.name}(${hint.params.map((param, index) => `\${${index + 1}:${param.name}}`).join(", ")})`;
  return {
    label: hint.name,
    kind: isField ? "field" : "method",
    insertText,
    snippet: !isField && hint.params.length > 0,
    detail: signature(hint),
    documentation: hint.summary,
    ...(hint.docs ? { docs: hint.docs } : {}),
    imports: [],
  };
}

/** The class this file extends, if it is one the hints know. */
function extendedClass(masked: string): string | undefined {
  return /\bclass\s+\w+\s+extends\s+(\w+)/.exec(masked)?.[1];
}

/** The declared type of a local variable, parameter, or field, looking back from `before`. */
function declaredType(masked: string, name: string, before: number): string | undefined {
  const pattern = new RegExp(`\\b([A-Z][\\w$]*)(?:\\s*<[^;{}()]*?>)?\\s+${name}\\s*(?=[=;,):])`, "g");
  let found: string | undefined;
  for (const match of masked.slice(0, before).matchAll(pattern)) found = match[1];
  if (!found) {
    // Fields may be declared after the method that uses them.
    for (const match of masked.matchAll(pattern)) found = match[1];
  }
  return found;
}

interface Segment {
  name: string;
  call: boolean;
  args: string;
}

/** Reads `a.b(c).d` backwards from just before a dot. Returns null for anything more complex. */
function receiverSegments(masked: string, end: number): Segment[] | null {
  const segments: Segment[] = [];
  let index = end;
  for (;;) {
    while (index > 0 && /\s/.test(masked[index - 1])) index -= 1;
    let call = false;
    let args = "";
    if (masked[index - 1] === ")") {
      let depth = 0;
      let open = index - 1;
      for (; open >= 0; open -= 1) {
        if (masked[open] === ")") depth += 1;
        else if (masked[open] === "(") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (open < 0) return null;
      args = masked.slice(open + 1, index - 1);
      call = true;
      index = open;
      while (index > 0 && /\s/.test(masked[index - 1])) index -= 1;
    }
    let start = index;
    while (start > 0 && /[\w$]/.test(masked[start - 1])) start -= 1;
    if (start === index) return null;
    segments.unshift({ name: masked.slice(start, index), call, args });
    index = start;
    while (index > 0 && /\s/.test(masked[index - 1])) index -= 1;
    if (masked[index - 1] !== ".") return segments;
    index -= 1;
  }
}

interface Resolved {
  type: string;
  isStatic: boolean;
}

function memberType(type: string, segment: Segment, isStatic: boolean): Resolved | undefined {
  const candidates = membersOf(type).filter((hint) => hint.name === segment.name);
  const hint = candidates.find((item) => (item.kind === "field" || item.kind === "staticField") !== segment.call && (item.kind.startsWith("static") || !isStatic));
  if (!hint) return undefined;
  let returns = hint.returns;
  // hardwareMap.get(DcMotorEx.class, "name") returns the class passed in.
  if (/^[A-Z]$/.test(returns)) {
    const classArgument = /\b([A-Z][\w$]*)\s*\.\s*class\b/.exec(segment.args);
    if (!classArgument) return undefined;
    returns = classArgument[1];
  }
  return { type: returns, isStatic: false };
}

function resolve(masked: string, segments: Segment[], offset: number): Resolved | undefined {
  const [first, ...rest] = segments;
  const base = extendedClass(masked);
  let current: Resolved | undefined;
  if (first.call) {
    current = base ? memberType(base, first, false) : undefined;
  } else {
    const variable = declaredType(masked, first.name, offset);
    if (variable) current = { type: variable, isStatic: false };
    else if (CLASSES[first.name]) current = { type: first.name, isStatic: true };
    else if (base && IMPLICIT_OPMODE.has(base)) current = memberType(base, first, false);
  }
  for (const segment of rest) {
    if (!current) return undefined;
    current = memberType(current.type, segment, current.isStatic);
  }
  return current;
}

function importsNeeded(source: string, masked: string, qualified: string): string[] {
  const packageName = qualified.slice(0, qualified.lastIndexOf("."));
  if (packageName === packageOf(source) || packageName === "java.lang") return [];
  const imported = [...masked.matchAll(/^\s*import\s+([\w.]+(?:\.\*)?)\s*;/gm)].map((match) => match[1]);
  return imported.includes(qualified) || imported.includes(`${packageName}.*`) ? [] : [qualified];
}

const startsWith = (label: string, prefix: string) => label.toLowerCase().startsWith(prefix.toLowerCase());

export function javaCompletions(source: string, offset: number): CompletionResult {
  const masked = maskJava(source);
  let from = offset;
  while (from > 0 && /[\w$]/.test(masked[from - 1])) from -= 1;
  const prefix = source.slice(from, offset);
  // A marker typed at the cursor is masked away only inside a comment or string literal.
  if (maskJava(`${source.slice(0, offset)}x`).endsWith(" ")) return { from, items: [] };

  let dot = from;
  while (dot > 0 && /\s/.test(masked[dot - 1])) dot -= 1;
  if (masked[dot - 1] === ".") {
    const segments = receiverSegments(masked, dot - 1);
    const resolved = segments && resolve(masked, segments, offset);
    if (!resolved) return { from, items: [] };
    const items = membersOf(resolved.type)
      .filter((hint) => (resolved.isStatic ? hint.kind.startsWith("static") : !hint.kind.startsWith("static")))
      .filter((hint) => startsWith(hint.name, prefix))
      .map(toItem);
    return { from, items };
  }

  const items: CompletionItem[] = [];
  for (const [name, qualified] of Object.entries(CLASSES)) {
    if (!startsWith(name, prefix)) continue;
    items.push({ label: name, kind: "class", insertText: name, snippet: false, detail: qualified, imports: importsNeeded(source, masked, qualified) });
  }
  const base = extendedClass(masked);
  if (base && IMPLICIT_OPMODE.has(base)) {
    for (const hint of membersOf(base)) {
      if (!hint.kind.startsWith("static") && startsWith(hint.name, prefix)) items.push(toItem(hint));
    }
  }
  const locals = new Set<string>();
  for (const match of masked.slice(0, offset).matchAll(/\b[A-Z][\w$]*(?:\s*<[^;{}()]*?>)?\s+([a-z_$][\w$]*)\s*(?=[=;,):])/g)) locals.add(match[1]);
  for (const name of locals) {
    if (name !== prefix && startsWith(name, prefix)) {
      items.push({ label: name, kind: "variable", insertText: name, snippet: false, detail: declaredType(masked, name, offset) ?? "", imports: [] });
    }
  }
  for (const snippet of SNIPPETS) {
    if (!startsWith(snippet.label, prefix)) continue;
    const imports = snippet.imports.flatMap((qualified) => importsNeeded(source, masked, qualified));
    items.push({ label: snippet.label, kind: "snippet", insertText: snippet.body, snippet: true, detail: snippet.summary, imports });
  }
  return { from, items };
}
