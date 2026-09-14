const JAVA_KEYWORDS = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char", "class", "const", "continue",
  "default", "do", "double", "else", "enum", "extends", "final", "finally", "float", "for", "goto", "if",
  "implements", "import", "instanceof", "int", "interface", "long", "native", "new", "package", "private",
  "protected", "public", "return", "short", "static", "strictfp", "super", "switch", "synchronized", "this",
  "throw", "throws", "transient", "try", "void", "volatile", "while", "true", "false", "null", "var", "record",
  "yield", "sealed", "permits", "non-sealed", "_",
]);

/** A Java identifier made of ASCII letters, digits, `_`, or `const JAVA_KEYWORDS = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char", "class", "const", "continue",
  "default", "do", "double", "else", "enum", "extends", "final", "finally", "float", "for", "goto", "if",
  "implements", "import", "instanceof", "int", "interface", "long", "native", "new", "package", "private",
  "protected", "public", "return", "short", "static", "strictfp", "super", "switch", "synchronized", "this",
  "throw", "throws", "transient", "try", "void", "volatile", "while", "true", "false", "null", "var", "record",
  "yield", "sealed", "permits", "non-sealed", "_",
]);

 that is not a keyword. */
export function isJavaIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !JAVA_KEYWORDS.has(name);
}

/** A package or class name such as `org.firstinspires.ftc.teamcode.auto`. */
export function isQualifiedName(name: string): boolean {
  return name.split(".").every(isJavaIdentifier);
}

/** Splits a display name into words, keeping letters and digits. */
export function words(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

function safe(identifier: string, prefix: string): string {
  let result = identifier || prefix;
  if (/^[0-9]/.test(result)) result = `${prefix}${result}`;
  if (JAVA_KEYWORDS.has(result.toLowerCase())) result = `${result}${prefix}`;
  return result;
}

/** `blue close auto` becomes `BlueCloseAuto`. */
export function pascalCase(name: string, fallback: string): string {
  return safe(words(name).map(capitalize).join(""), fallback);
}

/** `To Score` becomes `toScore`. */
export function camelCase(name: string, fallback: string): string {
  const parts = words(name).map(capitalize);
  if (!parts.length) return fallback;
  parts[0] = parts[0].toLowerCase();
  return safe(parts.join(""), fallback);
}

/** `Half Open` becomes `HALF_OPEN`. */
export function constantCase(name: string, fallback: string): string {
  return safe(words(name).map((word) => word.toUpperCase()).join("_"), fallback);
}

/** `My Robot` becomes `myrobot`, a valid Java package segment. */
export function packageSegment(name: string, fallback: string): string {
  const segment = words(name).join("").toLowerCase();
  return safe(segment, fallback);
}

/** Hands out unique identifiers, adding a number when a name is already taken. */
export class NameScope {
  private readonly taken = new Set<string>();

  constructor(reserved: Iterable<string> = []) {
    for (const name of reserved) this.taken.add(name.toLowerCase());
  }

  claim(candidate: string): string {
    let name = candidate;
    let counter = 2;
    while (this.taken.has(name.toLowerCase())) name = `${candidate}${counter++}`;
    this.taken.add(name.toLowerCase());
    return name;
  }
}

/** A Java string literal. */
export function javaString(value: string): string {
  let out = '"';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === '"') out += '\\"';
    else if (char === "\\") out += "\\\\";
    else if (char === "\n") out += "\\n";
    else if (char === "\r") out += "\\r";
    else if (char === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += char;
  }
  return `${out}"`;
}

/** A readable Java numeric literal with at most six decimal places. */
export function javaNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Cannot write ${value} as a Java number.`);
  const rounded = Math.round(value * 1e6) / 1e6;
  if (Object.is(rounded, -0) || Math.abs(rounded) < 1e-9) return "0";
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(6).replace(/0+$/, "");
}

/** Text for a Javadoc or line comment, with comment terminators removed. */
export function commentText(value: string): string {
  return value.replace(/\*\//g, "* /").replace(/[\r\n]+/g, " ").trim();
}
