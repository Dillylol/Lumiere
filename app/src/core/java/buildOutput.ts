/**
 * Turns Gradle and javac console output into problems the editor can show next to the code.
 * Works line by line on `--console=plain` output, which is what the desktop backend requests.
 */

export type ProblemSeverity = "error" | "warning";

export interface BuildProblem {
  severity: ProblemSeverity;
  message: string;
  /** Project-relative path with forward slashes when the file is inside the project, else as printed. */
  file?: string;
  line?: number;
  /** 1-based column from javac's caret line. */
  column?: number;
  /** Extra javac lines such as `symbol:` and `location:`. */
  details: string[];
}

export type BuildOutcome = "success" | "failure" | "unknown";

export interface BuildSummary {
  outcome: BuildOutcome;
  problems: BuildProblem[];
  /** Gradle's explanation when the build failed for a reason other than a compile error. */
  failure?: string;
}

const JAVAC = /^(.+\.java):(\d+): (error|warning): (.*)$/;
const DETAIL = /^\s+(symbol|location|required|found|reason|where)\b/;

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function relativeToProject(file: string, projectDir?: string): string {
  const normalized = normalizePath(file);
  if (!projectDir) return normalized;
  const root = normalizePath(projectDir).replace(/\/+$/, "") + "/";
  // Windows paths compare without regard to case.
  const inside = /^[a-z]:\//i.test(root) ? normalized.toLowerCase().startsWith(root.toLowerCase()) : normalized.startsWith(root);
  return inside ? normalized.slice(root.length) : normalized;
}

export function parseBuildOutput(lines: readonly string[], projectDir?: string): BuildSummary {
  const problems: BuildProblem[] = [];
  const seen = new Set<string>();
  let outcome: BuildOutcome = "unknown";
  const failureLines: string[] = [];
  let inFailure = false;
  let current: { problem: BuildProblem; indent: number; source?: string } | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line === "BUILD SUCCESSFUL" || line.startsWith("BUILD SUCCESSFUL in ")) outcome = "success";
    if (line === "BUILD FAILED" || line.startsWith("BUILD FAILED in ")) outcome = "failure";

    if (line === "* What went wrong:") {
      inFailure = true;
      current = null;
      continue;
    }
    if (inFailure && /^\* (Try|Get more help|Exception is):?/.test(line)) {
      inFailure = false;
    }

    const indent = raw.length - raw.trimStart().length;
    const match = JAVAC.exec(line.trimStart());
    if (match) {
      const [, file, lineNumber, severity, message] = match;
      const problem: BuildProblem = {
        severity: severity as ProblemSeverity,
        message,
        file: relativeToProject(file, projectDir),
        line: Number(lineNumber),
        details: [],
      };
      // Gradle repeats compiler errors under "What went wrong"; keep the first report.
      const key = `${problem.file}:${problem.line}:${severity}:${message}`;
      if (seen.has(key)) {
        current = null;
      } else {
        seen.add(key);
        problems.push(problem);
        current = { problem, indent };
      }
      continue;
    }

    if (current) {
      const body = raw.slice(Math.min(current.indent, indent));
      if (current.source === undefined && current.problem.column === undefined && body.trim() && !DETAIL.test(body)) {
        current.source = body;
        continue;
      }
      if (current.source !== undefined && current.problem.column === undefined && /^\s*\^\s*$/.test(body)) {
        current.problem.column = body.indexOf("^") + 1;
        continue;
      }
      if (DETAIL.test(body)) {
        current.problem.details.push(body.trim());
        continue;
      }
      current = null;
    }

    if (inFailure && line.trim() && !JAVAC.test(line.trimStart())) {
      failureLines.push(line.trim().replace(/^> /, ""));
    }
  }

  const summary: BuildSummary = { outcome, problems };
  const hasCompileErrors = problems.some((problem) => problem.severity === "error");
  if (outcome === "failure" && failureLines.length && !hasCompileErrors) {
    summary.failure = failureLines.join("\n");
  }
  return summary;
}
