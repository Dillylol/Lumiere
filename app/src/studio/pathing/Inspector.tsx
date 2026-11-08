import { useRef, useState, type ReactNode } from "react";
import { PanelRight, Pipette, Plus, Trash2, X } from "lucide-react";
import {
  deletePath, FIELD_FLOOR_INCHES, insertControlPoint, movePoint, pathColor, removeControlPoint, setHeading, setWaitAfter, updatePath, waitAfter,
  type AutonomousProgram, type Heading, type HeadingSegment, type PathDoc, type PathProfile, type Project,
} from "../../core";
import { FIELD_OPTIONS, type FieldId } from "./fields";
import type { Selection } from "./FieldView";

const PRESETS = Array.from({ length: 8 }, (_, index) => pathColor(index));
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** A bare number input that only passes valid values on and clamps the rest when it loses focus. */
function NumInput({ label, value, onChange, min, max, step = 1, className }: { label: string; value: number; onChange(value: number): void; min?: number; max?: number; step?: number; className?: string }) {
  const [draft, setDraft] = useState<string>();
  const valid = (n: number) => Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max);
  const commit = () => {
    if (draft === undefined) return;
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n)) {
      const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
      if (next !== value) onChange(next);
    }
    setDraft(undefined);
  };
  return <input className={className ? `pv-input ${className}` : "pv-input"} type="number" aria-label={label} step={step} min={min} max={max}
    value={draft ?? (Number.isFinite(value) ? Number(value.toFixed(2)) : 0)}
    aria-invalid={draft !== undefined && !valid(Number(draft.trim() === "" ? NaN : draft)) ? true : undefined}
    onChange={(event) => { setDraft(event.target.value); const n = event.target.valueAsNumber; if (valid(n)) onChange(n); }}
    onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") commit(); }}/>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="pv-field-label"><span>{label}</span>{children}</label>;
}

const HEADING_TYPES: { value: Heading["type"]; label: string; hint: string }[] = [
  { value: "constant", label: "Constant", hint: "The robot keeps the same heading for the whole path." },
  { value: "linear", label: "Linear", hint: "The heading turns evenly from a start angle to an end angle." },
  { value: "tangential", label: "Tangential", hint: "The heading follows the direction of the path." },
  { value: "piecewise", label: "Piecewise", hint: "The path is split into stretches that each use their own rule." },
];

function headingOfType(type: Heading["type"], current: Heading): Heading {
  const degrees = current.type === "constant" ? current.degrees : current.type === "linear" ? current.endDeg : 0;
  switch (type) {
    case "linear": return { type, startDeg: current.type === "linear" ? current.startDeg : degrees, endDeg: degrees };
    case "constant": return { type, degrees };
    case "tangential": return { type, reverse: false };
    case "piecewise": return { type, segments: [{ startProgress: 0, endProgress: 1, type: "tangential", reverse: false }] };
  }
}

function segmentOfType(segment: HeadingSegment, type: HeadingSegment["type"]): HeadingSegment {
  const range = { startProgress: segment.startProgress, endProgress: segment.endProgress };
  switch (type) {
    case "linear": return { ...range, type, startDeg: 0, endDeg: 90 };
    case "constant": return { ...range, type, degrees: 0 };
    case "tangential": return { ...range, type, reverse: false };
    case "facingPoint": return { ...range, type, point: { x: 70.75, y: 70.75 } };
  }
}

/** The four heading rules as one segmented control, with the fields each rule needs. */
function HeadingControls({ heading, onChange }: { heading: Heading; onChange(heading: Heading): void }) {
  const setSegment = (index: number, segment: HeadingSegment) =>
    heading.type === "piecewise" && onChange({ ...heading, segments: heading.segments.map((item, i) => (i === index ? segment : item)) });
  return <div className="pv-heading">
    <div className="pv-segmented" role="group" aria-label="Heading type">
      {HEADING_TYPES.map((option) => <button key={option.value} type="button" title={option.hint} aria-pressed={heading.type === option.value}
        className={heading.type === option.value ? "active" : undefined} onClick={() => heading.type !== option.value && onChange(headingOfType(option.value, heading))}>{option.label}</button>)}
    </div>
    {heading.type === "linear" && <div className="pv-pair">
      <Field label="Start (deg)"><NumInput label="Start (deg)" value={heading.startDeg} onChange={(startDeg) => onChange({ ...heading, startDeg })}/></Field>
      <Field label="End (deg)"><NumInput label="End (deg)" value={heading.endDeg} onChange={(endDeg) => onChange({ ...heading, endDeg })}/></Field>
    </div>}
    {heading.type === "constant" && <Field label="Heading (deg)"><NumInput label="Heading (deg)" value={heading.degrees} onChange={(degrees) => onChange({ ...heading, degrees })}/></Field>}
    {heading.type === "tangential" && <label className="pv-check"><input type="checkbox" checked={heading.reverse} onChange={(event) => onChange({ ...heading, reverse: event.target.checked })}/>Reverse: drive backwards along the path</label>}
    {heading.type === "piecewise" && <div className="pv-piecewise">
      {heading.segments.map((segment, index) => <div key={index} className="pv-rule">
        <div className="pv-rule-head">
          <span>Rule {index + 1}</span>
          {heading.segments.length > 1 && <button type="button" className="pv-icon tiny" aria-label={`Remove rule ${index + 1}`} onClick={() => onChange({ ...heading, segments: heading.segments.filter((_, i) => i !== index) })}><X/></button>}
        </div>
        <div className="pv-pair">
          <Field label="From (%)"><NumInput label={`Rule ${index + 1} from (%)`} min={0} max={100} value={Math.round(segment.startProgress * 1000) / 10} onChange={(value) => setSegment(index, { ...segment, startProgress: value / 100 })}/></Field>
          <Field label="To (%)"><NumInput label={`Rule ${index + 1} to (%)`} min={0} max={100} value={Math.round(segment.endProgress * 1000) / 10} onChange={(value) => setSegment(index, { ...segment, endProgress: value / 100 })}/></Field>
        </div>
        <select className="pv-input" aria-label={`Rule ${index + 1}`} value={segment.type} onChange={(event) => setSegment(index, segmentOfType(segment, event.target.value as HeadingSegment["type"]))}>
          <option value="constant">Constant</option><option value="linear">Linear</option><option value="tangential">Tangential</option><option value="facingPoint">Facing a point</option>
        </select>
        {segment.type === "linear" && <div className="pv-pair">
          <NumInput label={`Rule ${index + 1} start (deg)`} value={segment.startDeg} onChange={(startDeg) => setSegment(index, { ...segment, startDeg })}/>
          <NumInput label={`Rule ${index + 1} end (deg)`} value={segment.endDeg} onChange={(endDeg) => setSegment(index, { ...segment, endDeg })}/>
        </div>}
        {segment.type === "constant" && <NumInput label={`Rule ${index + 1} heading (deg)`} value={segment.degrees} onChange={(degrees) => setSegment(index, { ...segment, degrees })}/>}
        {segment.type === "tangential" && <label className="pv-check"><input type="checkbox" checked={segment.reverse} onChange={(event) => setSegment(index, { ...segment, reverse: event.target.checked })}/>Reverse</label>}
        {segment.type === "facingPoint" && <div className="pv-pair">
          <NumInput label={`Rule ${index + 1} point X`} min={0} max={FIELD_FLOOR_INCHES} value={segment.point.x} onChange={(x) => setSegment(index, { ...segment, point: { ...segment.point, x } })}/>
          <NumInput label={`Rule ${index + 1} point Y`} min={0} max={FIELD_FLOOR_INCHES} value={segment.point.y} onChange={(y) => setSegment(index, { ...segment, point: { ...segment.point, y } })}/>
        </div>}
      </div>)}
      {heading.segments.length < 20 && <button type="button" className="pv-ghost-button" onClick={() => {
        const last = heading.segments[heading.segments.length - 1];
        const middle = (last.startProgress + last.endProgress) / 2;
        onChange({ ...heading, segments: [...heading.segments.slice(0, -1), { ...last, endProgress: middle }, { ...segmentOfType(last, "tangential"), startProgress: middle, endProgress: last.endProgress }] });
      }}><Plus/>Add rule</button>}
    </div>}
  </div>;
}

function PathInspector({ program, path, number, profile, selection, onCommit, onSelect }: {
  program: AutonomousProgram; path: PathDoc; number: number; profile?: PathProfile; selection: Selection;
  onCommit(program: AutonomousProgram, select?: Selection): void; onSelect(selection: Selection): void;
}) {
  const custom = useRef<HTMLInputElement>(null);
  const rows = path.kind === "atomic" ? [
    { label: "End", ref: { kind: "end" as const, pathId: path.id }, point: path.end, index: -1 },
    ...path.controlPoints.map((point, index) => ({ label: `C${index + 1}`, ref: { kind: "control" as const, pathId: path.id, index }, point, index })),
  ] : [];
  return <div className="pv-stack">
    <div className="pv-name-row">
      <Field label="Name"><input className="pv-input" value={path.name} placeholder={`Path ${number}`} onChange={(event) => onCommit(updatePath(program, path.id, { name: event.target.value }))}/></Field>
      <button type="button" className="pv-icon danger" aria-label="Delete path" title="Delete path" onClick={() => onCommit(deletePath(program, path.id), {})}><Trash2/></button>
    </div>
    <Field label="Wait after the path (ms)">
      <NumInput label="Wait after the path (ms)" min={0} max={600000} step={100} value={waitAfter(program, path.id)} onChange={(ms) => onCommit(setWaitAfter(program, path.id, ms))}/>
    </Field>
    <div className="pv-field-label">
      <span>Color</span>
      <div className="pv-swatches">
        {PRESETS.map((color) => <button key={color} type="button" className={color.toLowerCase() === path.color.toLowerCase() ? "pv-swatch selected" : "pv-swatch"} style={{ background: color }}
          aria-label={`Color ${color}`} aria-pressed={color.toLowerCase() === path.color.toLowerCase()} onClick={() => onCommit(updatePath(program, path.id, { color }))}/>)}
        <button type="button" className="pv-icon tiny" aria-label="Custom color" title="Custom color" onClick={() => custom.current?.click()}><Pipette/></button>
        <input ref={custom} type="color" hidden value={path.color} onChange={(event) => onCommit(updatePath(program, path.id, { color: event.target.value }))}/>
      </div>
    </div>
    {path.kind === "atomic" ? <>
      <div className="pv-field-label">
        <div className="pv-points-head">
          <span>Points</span>
          <button type="button" className="pv-ghost-button" aria-label="Add control point" title="Add control point (A)" disabled={path.controlPoints.length >= 16} onClick={() => onCommit(insertControlPoint(program, path.id), { pathId: path.id })}><Plus/>Control point</button>
        </div>
        <div className="pv-points">
          {rows.map((row) => {
            const selected = selection.point && selection.point.kind !== "start" && selection.point.kind === row.ref.kind && (row.ref.kind === "end" || (selection.point.kind === "control" && selection.point.index === row.index));
            return <div key={row.label} className="pv-point-row">
              <span className={selected ? "pv-chip selected" : "pv-chip"}>{row.label}</span>
              {(["x", "y"] as const).map((axis) => <NumInput key={axis} className="mono" label={`${row.label} ${axis.toUpperCase()}`} min={0} max={FIELD_FLOOR_INCHES} step={0.5} value={row.point[axis]}
                onChange={(value) => { onSelect({ pathId: path.id, point: row.ref }); onCommit(movePoint(program, row.ref, { ...row.point, [axis]: value })); }}/>)}
              {row.ref.kind === "control"
                ? <button type="button" className="pv-icon tiny danger" aria-label={`Delete control point ${row.index + 1}`} onClick={() => onCommit(removeControlPoint(program, path.id, row.index), { pathId: path.id })}><X/></button>
                : <span className="pv-icon-space"/>}
            </div>;
          })}
        </div>
      </div>
      <div className="pv-field-label">
        <span>Heading</span>
        <HeadingControls heading={path.heading} onChange={(heading) => onCommit(setHeading(program, path.id, heading))}/>
      </div>
    </> : <p className="pv-empty">A group of {path.segments.length} pieces followed without stopping. Edit its pieces in a .pp file.</p>}
    {profile && <dl className="pv-estimate">
      <div><dt>Estimated time</dt><dd>{seconds(profile.durationMs)}</dd></div>
      <div><dt>Top speed</dt><dd>{profile.topSpeed.toFixed(0)} in/s</dd></div>
      {profile.turnMs > 0 && <div><dt>Turns in place first</dt><dd>{seconds(profile.turnMs)}</dd></div>}
    </dl>}
  </div>;
}

function ProjectInspector({ project, program, fieldId, customImage, onField, onCustomImage, onCommit, onOpenRobot }: {
  project: Project; program: AutonomousProgram; fieldId: FieldId; customImage: string | null;
  onField(id: FieldId): void; onCustomImage(): void; onCommit(program: AutonomousProgram): void; onOpenRobot(): void;
}) {
  const robot = project.robot;
  return <div className="pv-stack">
    <div className="pv-group">
      <h3>Start point</h3>
      <div className="pv-pair">
        <Field label="X"><NumInput label="Start X" min={0} max={FIELD_FLOOR_INCHES} value={program.start.x} onChange={(x) => onCommit({ ...program, start: { ...program.start, x } })}/></Field>
        <Field label="Y"><NumInput label="Start Y" min={0} max={FIELD_FLOOR_INCHES} value={program.start.y} onChange={(y) => onCommit({ ...program, start: { ...program.start, y } })}/></Field>
      </div>
      <Field label="Heading (deg)"><NumInput label="Start heading (deg)" value={program.start.headingDeg} onChange={(headingDeg) => onCommit({ ...program, start: { ...program.start, headingDeg } })}/></Field>
    </div>
    <div className="pv-group">
      <h3>Field</h3>
      <select className="pv-input" aria-label="Field" value={fieldId} onChange={(event) => onField(event.target.value as FieldId)}>
        {FIELD_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      {fieldId === "custom" && <button type="button" className="pv-ghost-button" onClick={onCustomImage}>{customImage ? "Choose another image" : "Choose an image"}</button>}
    </div>
    <div className="pv-group">
      <h3>Robot</h3>
      <dl className="pv-estimate">
        <div><dt>Size</dt><dd>{robot.lengthInches} × {robot.widthInches} in</dd></div>
        <div><dt>Forward / strafe speed</dt><dd>{robot.maxForwardVelocity} / {robot.maxStrafeVelocity} in/s</dd></div>
        <div><dt>Timing</dt><dd>{robot.constants ? `Pedro constants${robot.constants.tuned === false ? " (untuned)" : ""}` : "Robot profile"}</dd></div>
      </dl>
      <button type="button" className="pv-ghost-button" onClick={onOpenRobot}>Edit the robot profile</button>
    </div>
    <p className="pv-credit">Based on the Pedro Pathing Visualizer (Apache-2.0). See Credits on the Learn page.</p>
  </div>;
}

export interface InspectorProps {
  project: Project;
  program: AutonomousProgram;
  selection: Selection;
  profiles: Map<string, PathProfile>;
  fieldId: FieldId;
  customImage: string | null;
  onField(id: FieldId): void;
  onCustomImage(): void;
  onCommit(program: AutonomousProgram, select?: Selection): void;
  onSelect(selection: Selection): void;
  onOpenRobot(): void;
  onHide(): void;
}

/** The selected path's properties, or the program's start, field and robot when nothing is selected. */
export function Inspector(props: InspectorProps) {
  const { program, selection } = props;
  const index = program.paths.findIndex((item) => item.id === selection.pathId);
  const path = program.paths[index];
  return <aside className="pv-panel pv-inspector" aria-label="Inspector">
    <div className="pv-panel-head">
      <h2>{path ? (path.kind === "compound" ? "Group" : "Path") : "Project"}</h2>
      <button type="button" className="pv-icon small" aria-label="Hide inspector" title="Hide inspector" onClick={props.onHide}><PanelRight/></button>
    </div>
    <div className="pv-panel-scroll">
      {path
        ? <PathInspector program={program} path={path} number={index + 1} profile={props.profiles.get(path.id)} selection={selection} onCommit={props.onCommit} onSelect={props.onSelect}/>
        : <ProjectInspector project={props.project} program={program} fieldId={props.fieldId} customImage={props.customImage} onField={props.onField}
          onCustomImage={props.onCustomImage} onCommit={props.onCommit} onOpenRobot={props.onOpenRobot}/>}
    </div>
  </aside>;
}
