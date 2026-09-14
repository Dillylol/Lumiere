import { BRAND } from "../brand";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Crosshair, MousePointer2, Plus, Trash2 } from "lucide-react";
import type { ProgramAction, ProgramIR } from "../models/project";
import { Modal } from "./ui/Modal";

interface PathEditorProps {
  ir: ProgramIR;
  onChange: (ir: ProgramIR) => void;
}

interface PathPoint {
  actionId: string;
  x: number;
  y: number;
  heading: number;
  mode: "linear" | "tangent" | "constant" | "seg";
}

const modes: PathPoint["mode"][] = ["linear", "tangent", "constant", "seg"];
const clamp = (value: number) => Math.max(0, Math.min(144, Math.round(value * 10) / 10));

export function PathEditor({ ir, onChange }: PathEditorProps) {
  const points = useMemo(() => pathPoints(ir.actions), [ir.actions]);
  const [selectedId, setSelectedId] = useState<string>();
  const [clearOpen, setClearOpen] = useState(false);
  const selected = points.find((point) => point.actionId === selectedId);

  useEffect(() => {
    if (selectedId && !points.some((point) => point.actionId === selectedId)) setSelectedId(points[0]?.actionId);
  }, [points, selectedId]);

  const addPoint = (x = 72, y = 72) => {
    const point: PathPoint = { actionId: `action-${crypto.randomUUID()}`, x: clamp(x), y: clamp(y), heading: 0, mode: "linear" };
    const action = pointAction(point, points.length + 1);
    onChange({ ...ir, actions: [...ir.actions, action] });
    setSelectedId(action.id);
  };

  const addFromField = (event: MouseEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget && (event.target as Element).closest("[data-path-point]")) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    addPoint((event.clientX - bounds.left) / bounds.width * 144, (event.clientY - bounds.top) / bounds.height * 144);
  };

  const updatePoint = (point: PathPoint, patch: Partial<PathPoint>) => {
    const next = { ...point, ...patch };
    next.x = clamp(next.x);
    next.y = clamp(next.y);
    onChange({ ...ir, actions: ir.actions.map((action) => action.id === point.actionId ? pointAction(next, points.findIndex((item) => item.actionId === point.actionId) + 1, action) : action) });
  };

  const deletePoint = (id: string) => {
    onChange({ ...ir, actions: ir.actions.filter((action) => action.id !== id) });
    setSelectedId(points.find((point) => point.actionId !== id)?.actionId);
  };

  const clear = () => {
    onChange({ ...ir, actions: ir.actions.filter((action) => action.kind !== "path") });
    setSelectedId(undefined);
    setClearOpen(false);
  };

  const polyline = [{ x: 72, y: 72 }, ...points].map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <div className="path-editor">
      <div className="path-editor__field-panel">
        <div className="path-editor__toolbar"><span><MousePointer2 aria-hidden="true" /> Click the field to add a waypoint</span><button className="button button--secondary" type="button" onClick={() => addPoint()}><Plus aria-hidden="true" /> Add center point</button></div>
        <svg className="path-field" viewBox="0 0 144 144" role="img" aria-label={`FTC field path with ${points.length} waypoint${points.length === 1 ? "" : "s"}`} onClick={addFromField}>
          <defs><pattern id="path-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="currentColor" strokeWidth=".45" /></pattern></defs>
          <rect width="144" height="144" rx="3" className="path-field__surface" />
          <rect width="144" height="144" rx="3" fill="url(#path-grid)" className="path-field__grid" />
          <polyline points={polyline} className="path-field__line" />
          <g transform="translate(72 72)" className="path-field__start"><rect x="-4" y="-4" width="8" height="8" rx="1.5" /><path d="M0 -2.5 L2 1.5 L0.4 1 L0.4 3 L-0.4 3 L-0.4 1 L-2 1.5 Z" /></g>
          {points.map((point, index) => <g key={point.actionId} data-path-point="true" className={`path-field__point ${selectedId === point.actionId ? "selected" : ""}`} transform={`translate(${point.x} ${point.y}) rotate(${point.heading})`} role="button" tabIndex={0} aria-label={`Waypoint ${index + 1} at ${point.x}, ${point.y}`} onClick={(event) => { event.stopPropagation(); setSelectedId(point.actionId); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(point.actionId); } }}><circle r="5.2" /><path d="M0 -3.4 L2.7 2.4 L0 1.4 L-2.7 2.4 Z" /><text x="0" y="-7.4" textAnchor="middle" transform={`rotate(${-point.heading})`}>{index + 1}</text></g>)}
        </svg>
      </div>

      <aside className="path-editor__inspector">
        <div><p className="eyebrow">Path sequence</p><h3>{points.length ? `${points.length} waypoint${points.length === 1 ? "" : "s"}` : "No waypoints yet"}</h3><p>{points.length ? "Select a waypoint to edit its position and heading." : "Click anywhere on the field to start a path from the field center."}</p></div>
        <ol className="waypoint-list">{points.map((point, index) => <li key={point.actionId}><button type="button" className={selectedId === point.actionId ? "selected" : ""} onClick={() => setSelectedId(point.actionId)}><span>{index + 1}</span><strong>{point.mode}</strong><small>{point.x}, {point.y} · {point.heading}°</small></button></li>)}</ol>
        {selected && <fieldset className="waypoint-fields"><legend>Selected waypoint</legend><label>X (inches)<input type="number" min="0" max="144" step="1" value={selected.x} onChange={(event) => updatePoint(selected, { x: event.target.valueAsNumber })} /></label><label>Y (inches)<input type="number" min="0" max="144" step="1" value={selected.y} onChange={(event) => updatePoint(selected, { y: event.target.valueAsNumber })} /></label><label>Heading<input type="number" min="-360" max="360" step="5" value={selected.heading} onChange={(event) => updatePoint(selected, { heading: event.target.valueAsNumber })} /></label><label>Segment<select value={selected.mode} onChange={(event) => updatePoint(selected, { mode: event.target.value as PathPoint["mode"] })}>{modes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label><button className="button button--danger-quiet waypoint-delete" type="button" onClick={() => deletePoint(selected.actionId)}><Trash2 aria-hidden="true" /> Delete waypoint</button></fieldset>}
        {points.length > 0 && <button className="button button--ghost" type="button" onClick={() => setClearOpen(true)}><Trash2 aria-hidden="true" /> Clear path</button>}
        <div className="path-editor__note"><Crosshair aria-hidden="true" /><p><strong>Field coordinates</strong><br />0–144 inches. The center marker is 72,72. Changes update the same {BRAND.name} program used by Build and Simulate.</p></div>
      </aside>

      <Modal open={clearOpen} title="Clear this path?" description="Non-path program actions will stay in place." onClose={() => setClearOpen(false)} footer={<><button className="button button--ghost" type="button" onClick={() => setClearOpen(false)}>Cancel</button><button className="button button--danger" type="button" onClick={clear}>Clear waypoints</button></>}><p>This will remove {points.length} waypoint{points.length === 1 ? "" : "s"} from the active program.</p></Modal>
    </div>
  );
}

function pathPoints(actions: ProgramAction[]): PathPoint[] {
  return actions.flatMap((action) => {
    if (action.kind !== "path") return [];
    const [x, y, heading] = String(action.args.values ?? "").split(",").map((value) => Number(value.trim()));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    const mode = modes.includes(action.args.mode as PathPoint["mode"]) ? action.args.mode as PathPoint["mode"] : "linear";
    return [{ actionId: action.id, x: clamp(x), y: clamp(y), heading: Number.isFinite(heading) ? heading : 0, mode }];
  });
}

function pointAction(point: PathPoint, index: number, existing?: ProgramAction): ProgramAction {
  const statement = `path.${point.mode}(${point.x}, ${point.y}, ${point.heading})`;
  return {
    id: existing?.id ?? point.actionId,
    kind: "path",
    label: `Waypoint ${index}`,
    enabled: existing?.enabled ?? true,
    args: { mode: point.mode, values: `${point.x}, ${point.y}, ${point.heading}` },
    source: statement,
    leadingComments: existing?.leadingComments ?? [],
  };
}
