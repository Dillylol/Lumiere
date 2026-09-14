import { braceDepths, lineAt, maskJava, packageOf, scanTo, unescapeJavaString } from "./source";

export type OpModeFlavor = "autonomous" | "teleop";

/** An OpMode registered with `@Autonomous` or `@TeleOp`, as the Driver Station will list it. */
export interface OpModeDeclaration {
  className: string;
  qualifiedName: string;
  /** The annotation's `name`, or the class name when it is empty, as the FTC SDK does. */
  name: string;
  group: string;
  flavor: OpModeFlavor;
  /** `@Disabled` OpModes do not appear on the Driver Station. */
  disabled: boolean;
  preselectTeleOp?: string;
  /** 1-based line of the `@Autonomous` or `@TeleOp` annotation. */
  line: number;
}

const CLASS = /\bclass\s+([A-Za-z_$][\w$]*)/g;
const ANNOTATION = /@(?:[\w$]+\s*\.\s*)*([\w$]+)/g;

function stringArgument(argumentsText: string, key: string): string | undefined {
  const match = new RegExp(`\\b${key}\\s*=\\s*"((?:[^"\\\\\\n]|\\\\.)*)"`).exec(argumentsText);
  return match ? unescapeJavaString(match[1]) : undefined;
}

/** Offsets just after each `;`, `{`, or `}` outside parentheses: where a declaration's annotations can start. */
function declarationBoundaries(masked: string): number[] {
  const boundaries = [0];
  let parens = 0;
  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index];
    if (char === "(") parens += 1;
    else if (char === ")") parens = Math.max(0, parens - 1);
    else if (parens === 0 && (char === ";" || char === "{" || char === "}")) boundaries.push(index + 1);
  }
  return boundaries;
}

/** Finds the OpModes declared in one Java file. Comments and strings never produce matches. */
export function findOpModes(source: string): OpModeDeclaration[] {
  const masked = maskJava(source);
  const depths = braceDepths(masked);
  const boundaries = declarationBoundaries(masked);
  const packageName = packageOf(source);
  const results: OpModeDeclaration[] = [];
  const classes = [...masked.matchAll(CLASS)].map((match) => {
    const open = masked.indexOf("{", match.index);
    return { name: match[1], offset: match.index, open, end: open < 0 ? -1 : scanTo(masked, open + 1, "}") };
  });

  for (const declaration of masked.matchAll(CLASS)) {
    const classOffset = declaration.index;
    // Top-level classes and classes nested directly inside them.
    if (depths[classOffset] > 1) continue;
    let start = 0;
    for (const boundary of boundaries) {
      if (boundary > classOffset) break;
      start = boundary;
    }

    let flavor: OpModeFlavor | undefined;
    let argumentsText = "";
    let annotationOffset = -1;
    let disabled = false;
    let flavors = 0;
    const header = masked.slice(start, classOffset);
    for (const annotation of header.matchAll(ANNOTATION)) {
      const offset = start + annotation.index;
      const kind = annotation[1];
      let text = "";
      const afterName = offset + annotation[0].length;
      const open = /^\s*\(/.exec(masked.slice(afterName, classOffset));
      if (open) {
        const close = scanTo(masked, afterName + open[0].length, ")");
        if (close > 0) text = source.slice(afterName + open[0].length, close - 1);
      }
      if (kind === "Disabled") disabled = true;
      if (kind === "TeleOp" || kind === "Autonomous") {
        flavors += 1;
        flavor = kind === "TeleOp" ? "teleop" : "autonomous";
        argumentsText = text;
        annotationOffset = offset;
      }
    }
    const owner = classes.find((item) => item.open < classOffset && item.end > classOffset && depths[item.offset] === 0);
    const tail = masked.slice(classOffset, masked.indexOf("{", classOffset));
    if (!flavor || flavors !== 1 || !/\bpublic\b/.test(header) || !/\bextends\s+/.test(tail)) continue;
    if (owner && !/\bstatic\b/.test(header)) continue;
    // The SDK registers only concrete classes.
    if (/\babstract\b/.test(header)) continue;
    if (/\bextends\s+(?:java\.lang\.)?Object\b/.test(tail)) continue;

    const className = declaration[1];
    const name = stringArgument(argumentsText, "name");
    const preselectTeleOp = stringArgument(argumentsText, "preselectTeleOp");
    results.push({
      className,
      qualifiedName: [packageName, owner ? `${owner.name}$${className}` : className].filter(Boolean).join("."),
      name: name?.trim() ? name : className,
      group: stringArgument(argumentsText, "group") ?? "",
      flavor,
      disabled,
      ...(preselectTeleOp ? { preselectTeleOp } : {}),
      line: lineAt(source, annotationOffset),
    });
  }
  return results;
}
