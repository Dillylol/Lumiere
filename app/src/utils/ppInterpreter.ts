/**
 * PedroPathing `.pp` (JSON) → JULES flow DSL used by IdeTab / FlowEditor / parseDsl.
 * Mirrors logic in client/jules/pp_compiler.py (compile_pp / _segment_args).
 */

export type PpHeadingMode = 'linear' | 'tangential' | 'constant';

export interface PpControlPoint {
  x: number;
  y: number;
}

export interface PpEndPoint {
  x?: number;
  y?: number;
  heading?: string;
  startDeg?: number | null;
  endDeg?: number | null;
  degrees?: number;
  reverse?: boolean;
}

export interface PpLine {
  id?: string;
  name?: string;
  endPoint?: PpEndPoint;
  controlPoints?: PpControlPoint[];
}

export interface PpSequenceEntry {
  kind?: string;
  lineId?: string;
  durationMs?: number;
}

export interface PpDocument {
  version?: number;
  description?: string;
  startPoint?: { x?: number; y?: number; startDeg?: number };
  lines?: PpLine[];
  sequence?: PpSequenceEntry[];
}

/** Serialize one path segment for DSL (parses via path.seg(...) in julesConverter). */
export function encodePathSegLine(args: {
  pathType: PpHeadingMode;
  x: number;
  y: number;
  startHeading: number;
  endHeading: number;
  heading: number;
  reverse: boolean;
  controlPoints: { x: number; y: number }[];
}): string {
  const parts: string[] = [
    args.pathType,
    String(args.x),
    String(args.y),
    String(args.startHeading),
    String(args.endHeading),
    String(args.heading),
    args.reverse ? 'true' : 'false',
    ...args.controlPoints.flatMap((cp) => [String(cp.x), String(cp.y)]),
  ];
  return `path.seg(${parts.join('@')})`;
}

function quoteDslString(input: string): string {
  return `"${String(input).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function normalizeHeading(mode: string | undefined): PpHeadingMode {
  const h = (mode || 'linear').toLowerCase();
  if (h === 'linear' || h === 'lin') return 'linear';
  if (h === 'tangent' || h === 'tangential' || h === 'tangentinterp') return 'tangential';
  if (h === 'constant' || h === 'const' || h === 'hold') return 'constant';
  return 'linear';
}

/** Same contract as Python _segment_args (pp_compiler.py). */
export function ppLineToSegmentArgs(
  lastEndDegDefault: number,
  line: PpLine,
): {
  pathType: PpHeadingMode;
  x: number;
  y: number;
  startHeading: number;
  endHeading: number;
  heading: number;
  reverse: boolean;
  controlPoints: { x: number; y: number }[];
} {
  const end = line.endPoint || {};
  const mode = normalizeHeading(end.heading);

  const x = Number(end.x ?? 0);
  const y = Number(end.y ?? 0);

  let startDeg =
    end.startDeg === undefined || end.startDeg === null
      ? lastEndDegDefault
      : Number(end.startDeg);

  let endDeg =
    end.endDeg === undefined || end.endDeg === null ? startDeg : Number(end.endDeg);

  const degrees =
    end.degrees !== undefined ? Number(end.degrees) : mode === 'constant' ? endDeg : 0;

  const reverse = Boolean(end.reverse);

  const cps = (line.controlPoints || []).map((cp) => ({
    x: Number(cp.x ?? 0),
    y: Number(cp.y ?? 0),
  }));

  return {
    pathType: mode,
    x,
    y,
    startHeading: startDeg,
    endHeading: endDeg,
    heading: degrees,
    reverse,
    controlPoints: cps,
  };
}

/** Turn parsed .pp JSON into executable DSL (+ header comment). */
export function compilePpToDsl(pp: PpDocument, sourceHint?: string): string {
  if (!pp || typeof pp !== 'object') return '# Invalid .pp data';

  const linesById: Record<string, PpLine> = {};
  (pp.lines || []).forEach((ln, idx) => {
    const lid = ln.id ?? ln.name ?? `_idx_${idx}`;
    linesById[lid] = ln;
  });

  let seq = pp.sequence;
  if (!seq || seq.length === 0) {
    seq = Object.keys(linesById).map((id) => ({ kind: 'path', lineId: id }));
  }

  const startPt = pp.startPoint || {};
  let lastEndDeg = Number(startPt.startDeg ?? 0);

  let header = sourceHint
    ? `# Loaded from PedroPath .pp: ${sourceHint}`
    : `# Imported PedroPath (.pp)`;
  if (pp.description) header += ` — ${pp.description}`;
  const outLines: string[] = [header];
  let inChain = false;

  const push = (s: string) => {
    outLines.push(s);
  };

  const openChain = () => {
    if (!inChain) {
      push('path.start()');
      inChain = true;
    }
  };

  const closeChain = () => {
    if (inChain) {
      push('path.follow()');
      inChain = false;
    }
  };

  for (const entry of seq) {
    const kind = entry.kind;
    if (kind === 'path') {
      const lineId = entry.lineId;
      const line = lineId ? linesById[lineId] : undefined;
      if (!line) continue;
      openChain();
      const args = ppLineToSegmentArgs(lastEndDeg, line);
      const label = (line.name || line.id || '').trim();
      const labelArg = label ? `, ${quoteDslString(label)}` : '';
      if (args.pathType === 'linear') {
        push(`path.linear(${args.x}, ${args.y}, ${args.startHeading}, ${args.endHeading}${labelArg})`);
      } else if (args.pathType === 'constant') {
        push(`path.constant(${args.x}, ${args.y}, ${args.heading}${labelArg})`);
      } else {
        push(`path.tangent(${args.x}, ${args.y}, ${args.heading}, ${args.reverse ? 'true' : 'false'}${labelArg})`);
      }
      lastEndDeg = args.endHeading;
    } else if (kind === 'wait') {
      closeChain();
      const ms = Math.max(0, Math.floor(Number(entry.durationMs ?? 0)));
      if (ms > 0) push(`wait(${ms})`);
    } else {
      closeChain();
    }
  }
  closeChain();

  return outLines.join('\n');
}

export function compilePpJsonText(jsonText: string, sourceHint?: string): string {
  const data = JSON.parse(jsonText) as PpDocument;
  return compilePpToDsl(data, sourceHint);
}

/** Browser `File` from a hidden picker — parses JSON PedroPath `.pp`. */
export async function loadPedroPathFromBrowserFile(
  file: File,
): Promise<{ dsl: string; baseName: string }> {
  const text = await file.text();
  const dsl = compilePpJsonText(text, file.name);
  const baseName = file.name.replace(/\.pp$/i, '').trim() || 'imported_pp';
  return { dsl, baseName };
}
