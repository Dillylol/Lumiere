import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from "react";
import { ArrowDown, ArrowUp, Copy, Download, FlipHorizontal, Image, ImageOff, MousePointerClick, Pause, Play, Plus, Spline, Square, Trash2, Upload } from "lucide-react";
import {
  addPath, deletePath, endPose, estimateRoutine, exportVisualizer, FIELD_INCHES, importVisualizer, insertControlPoint, mirrorProgram,
  movePath, movePoint, newId, removeControlPoint, resolveProgramPaths, samplePath, setHeading, snapPoint, updatePath,
  AUTONOMOUS_PERIOD_MS, type AutonomousProgram, type Heading, type HeadingSegment, type Point, type PointRef, type Pose, type Project,
  type ResolvedPath, type RoutineEstimate, type Step,
} from "../../core";
import { NumberField } from "../ProgramEditor";
import { confirmAction, download } from "../store";
import "./pathing.css";

type Selection = { pathId?: string; point?: PointRef };
const SNAP_OPTIONS = [0, 1, 3, 6, 12];
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const storageKey = (projectId: string, name: string) => `lumiere-pathing-${name}:${projectId}`;
function readSetting(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function writeSetting(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* Settings then last for this session only. */ }
}
const sameRef = (a: PointRef | undefined, b: PointRef) => !!a && a.kind === b.kind
  && (a.kind === "start" || (b.kind !== "start" && a.pathId === b.pathId && (a.kind === "end" || (b.kind === "control" && a.index === b.index))));

/** The robot's footprint at a pose, length along its heading, with a bar on its front edge. */
function RobotShape({ pose, length, width, ghost = false }: { pose: Pose; length: number; width: number; ghost?: boolean }) {
  return <g transform={`translate(${pose.x} ${pose.y}) rotate(${(pose.heading * 180) / Math.PI})`} className={ghost ? "robot ghost" : "robot"} pointerEvents="none">
    <rect x={-length / 2} y={-width / 2} width={length} height={width} rx="1"/>
    <path d={`M0 0H${length / 2 - 1.2}`} className="robot-heading"/>
    <path d={`M${length / 2 - 1.2} ${-width / 2 + 1.5}V${width / 2 - 1.5}`} className="robot-front"/>
  </g>;
}

interface CanvasProps {
  project: Project;
  program: AutonomousProgram;
  paths: ResolvedPath[];
  selection: Selection;
  snap: number;
  addMode: boolean;
  pose?: Pose;
  fieldImage: string | null;
  onSelect(selection: Selection): void;
  onCommit(program: AutonomousProgram, select?: Selection): void;
  onHover(point: Point | null): void;
}

/**
 * The field: paths, their handles and the robot. A drag previews its edit here and commits once,
 * so each drag is one undo step.
 */
function FieldCanvas({ project, program, paths, selection, snap, addMode, pose, fieldImage, onSelect, onCommit, onHover }: CanvasProps) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ ref: PointRef; moved: boolean } | undefined>(undefined);
  const [draft, setDraft] = useState<AutonomousProgram>();
  const shown = draft ?? program;
  const shownPaths = draft ? resolveProgramPaths(draft).paths : paths;
  const { lengthInches: length, widthInches: width } = project.robot;
  const startPose: Pose = { x: shown.start.x, y: shown.start.y, heading: (shown.start.headingDeg * Math.PI) / 180 };

  const toField = (event: { clientX: number; clientY: number }): Point => {
    const element = svg.current!;
    const point = element.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(element.getScreenCTM()!.inverse());
    return { x: local.x, y: FIELD_INCHES - local.y };
  };
  const grab = (event: PointerEvent, ref: PointRef, pathId?: string) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { ref, moved: false };
    onSelect({ pathId: pathId ?? selection.pathId, point: ref });
  };
  const nudge = (event: ReactKeyboardEvent, ref: PointRef, at: Point) => {
    const step = event.shiftKey ? Math.max(snap, 6) : 1;
    const delta = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    onCommit(movePoint(program, ref, snapPoint({ x: at.x + delta[0], y: at.y + delta[1] }, 0)));
  };
  const add = (event: { clientX: number; clientY: number }) => {
    const { program: next, pathId } = addPath(program, snapPoint(toField(event), snap));
    onCommit(next, { pathId });
  };
  const handleProps = (ref: PointRef, label: string, at: Point, pathId?: string) => ({
    role: "button" as const, tabIndex: 0, "aria-label": label,
    className: sameRef(selection.point, ref) ? "handle selected" : "handle",
    onPointerDown: (event: PointerEvent) => grab(event, ref, pathId),
    onKeyDown: (event: ReactKeyboardEvent) => nudge(event, ref, at),
  });

  return <svg ref={svg} className="studio-field pathing-canvas" viewBox="-10 -6 160 160" role="group" tabIndex={-1}
    aria-label={`FTC field editor, ${FIELD_INCHES} by ${FIELD_INCHES} inches`}
    onPointerMove={(event) => {
      const point = toField(event);
      onHover(point.x >= 0 && point.x <= FIELD_INCHES && point.y >= 0 && point.y <= FIELD_INCHES ? point : null);
      if (!drag.current) return;
      drag.current.moved = true;
      setDraft(movePoint(draft ?? program, drag.current.ref, snapPoint(point, snap)));
    }}
    onPointerUp={() => {
      if (drag.current?.moved && draft) onCommit(draft);
      drag.current = undefined;
      setDraft(undefined);
    }}
    onPointerCancel={() => { drag.current = undefined; setDraft(undefined); }}
    onPointerLeave={() => onHover(null)}>
    <defs>
      <pattern id="pathing-grid" width="12" height="12" patternUnits="userSpaceOnUse">
        <rect width="12" height="12" fill="var(--field)"/>
        <path d="M12 0H0V12" fill="none" stroke="var(--border)" strokeWidth=".3"/>
      </pattern>
    </defs>
    <g onPointerDown={(event) => { if (event.button === 0 && addMode) add(event); else onSelect({}); }} onDoubleClick={add}>
      <rect x="0" y="0" width={FIELD_INCHES} height={FIELD_INCHES} fill="url(#pathing-grid)"/>
      {fieldImage && <image href={fieldImage} x="0" y="0" width={FIELD_INCHES} height={FIELD_INCHES} preserveAspectRatio="none" opacity=".92"/>}
      {[24, 48, 72, 96, 120].map((n) => <g key={n} className="tile-line"><line x1={n} y1="0" x2={n} y2={FIELD_INCHES}/><line x1="0" y1={n} x2={FIELD_INCHES} y2={n}/></g>)}
      <rect x="0" y="0" width={FIELD_INCHES} height={FIELD_INCHES} fill="none" stroke="var(--muted)" strokeWidth=".5"/>
    </g>
    {[0, 24, 48, 72, 96, 120, 144].map((n) => <g key={n} className="axis-label"><text x={n} y="150" textAnchor="middle">{n}</text><text x="-3" y={FIELD_INCHES + 1 - n} textAnchor="end">{n}</text></g>)}
    <g transform={`translate(0 ${FIELD_INCHES}) scale(1 -1)`}>
      {shownPaths.map((path) => <polyline key={path.doc.id} points={samplePath(path, 96).map((point) => `${point.x},${point.y}`).join(" ")}
        className={path.doc.id === selection.pathId ? "path-line selected" : "path-line"} stroke={path.doc.color}
        onPointerDown={(event) => { event.stopPropagation(); onSelect({ pathId: path.doc.id }); }}/>)}
      {shownPaths.map((path, index) => {
        if (path.doc.kind !== "atomic" || path.doc.id !== selection.pathId) return null;
        const points = [path.start, ...path.doc.controlPoints, path.end];
        return <g key={`${path.doc.id}-controls`}>
          <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} className="control-polygon"/>
          {path.doc.controlPoints.map((control, c) => <rect key={c} x={control.x - 1.7} y={control.y - 1.7} width="3.4" height="3.4" rx=".6"
            {...handleProps({ kind: "control", pathId: path.doc.id, index: c }, `Control point ${c + 1} of path ${index + 1}`, control, path.doc.id)}/>)}
        </g>;
      })}
      <RobotShape pose={startPose} length={length} width={width} ghost/>
      <circle cx={shown.start.x} cy={shown.start.y} r="2.2" fill="var(--mint)" {...handleProps({ kind: "start" }, "Start pose", shown.start)}/>
      {shownPaths.map((path, index) => path.doc.kind === "atomic"
        ? <circle key={`${path.doc.id}-end`} cx={path.end.x} cy={path.end.y} r="2.3" fill={path.doc.color}
          {...handleProps({ kind: "end", pathId: path.doc.id }, `Waypoint ${index + 1}`, path.end, path.doc.id)}/>
        : <circle key={`${path.doc.id}-end`} cx={path.end.x} cy={path.end.y} r="2" fill={path.doc.color} className="fixed-point"/>)}
      {pose && <RobotShape pose={pose} length={length} width={width}/>}
    </g>
  </svg>;
}

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
    case "facingPoint": return { ...range, type, point: { x: 72, y: 72 } };
  }
}

/** How the robot turns along a path, including piecewise rules that change partway. */
function HeadingEditor({ heading, onChange }: { heading: Heading; onChange(heading: Heading): void }) {
  const setSegment = (index: number, segment: HeadingSegment) =>
    heading.type === "piecewise" && onChange({ ...heading, segments: heading.segments.map((item, i) => i === index ? segment : item) });
  return <>
    <label>Heading<select value={heading.type} onChange={(event) => onChange(headingOfType(event.target.value as Heading["type"], heading))}>
      <option value="linear">Turns from start to end</option>
      <option value="constant">Faces one direction</option>
      <option value="tangential">Faces along the path</option>
      <option value="piecewise">Changes along the path</option>
    </select></label>
    {heading.type === "linear" && <div className="form-pair">
      <NumberField label="Heading start (°)" value={heading.startDeg} onChange={(startDeg) => onChange({ ...heading, startDeg })}/>
      <NumberField label="Heading end (°)" value={heading.endDeg} onChange={(endDeg) => onChange({ ...heading, endDeg })}/>
    </div>}
    {heading.type === "constant" && <NumberField label="Heading (°)" value={heading.degrees} onChange={(degrees) => onChange({ ...heading, degrees })}/>}
    {heading.type === "tangential" && <label className="check"><input type="checkbox" checked={heading.reverse} onChange={(event) => onChange({ ...heading, reverse: event.target.checked })}/>Drive backwards along the path</label>}
    {heading.type === "piecewise" && <div className="piecewise">
      {heading.segments.map((segment, index) => <fieldset key={index}>
        <legend>Rule {index + 1}</legend>
        <div className="form-pair">
          <NumberField label="From (%)" min={0} max={100} value={Math.round(segment.startProgress * 1000) / 10} onChange={(value) => setSegment(index, { ...segment, startProgress: value / 100 })}/>
          <NumberField label="To (%)" min={0} max={100} value={Math.round(segment.endProgress * 1000) / 10} onChange={(value) => setSegment(index, { ...segment, endProgress: value / 100 })}/>
        </div>
        <label>Rule<select value={segment.type} onChange={(event) => setSegment(index, segmentOfType(segment, event.target.value as HeadingSegment["type"]))}>
          <option value="linear">Turns from start to end</option>
          <option value="constant">Faces one direction</option>
          <option value="tangential">Faces along the path</option>
          <option value="facingPoint">Faces a point</option>
        </select></label>
        {segment.type === "linear" && <div className="form-pair">
          <NumberField label="Start (°)" value={segment.startDeg} onChange={(startDeg) => setSegment(index, { ...segment, startDeg })}/>
          <NumberField label="End (°)" value={segment.endDeg} onChange={(endDeg) => setSegment(index, { ...segment, endDeg })}/>
        </div>}
        {segment.type === "constant" && <NumberField label="Facing (°)" value={segment.degrees} onChange={(degrees) => setSegment(index, { ...segment, degrees })}/>}
        {segment.type === "tangential" && <label className="check"><input type="checkbox" checked={segment.reverse} onChange={(event) => setSegment(index, { ...segment, reverse: event.target.checked })}/>Backwards</label>}
        {segment.type === "facingPoint" && <div className="form-pair">
          <NumberField label="Point X (in)" min={0} max={FIELD_INCHES} value={segment.point.x} onChange={(x) => setSegment(index, { ...segment, point: { ...segment.point, x } })}/>
          <NumberField label="Point Y (in)" min={0} max={FIELD_INCHES} value={segment.point.y} onChange={(y) => setSegment(index, { ...segment, point: { ...segment.point, y } })}/>
        </div>}
        {heading.segments.length > 1 && <button className="text-button" onClick={() => onChange({ ...heading, segments: heading.segments.filter((_, i) => i !== index) })}>Remove rule {index + 1}</button>}
      </fieldset>)}
      {heading.segments.length < 20 && <button onClick={() => {
        const last = heading.segments[heading.segments.length - 1];
        const middle = (last.startProgress + last.endProgress) / 2;
        onChange({ ...heading, segments: [...heading.segments.slice(0, -1), { ...last, endProgress: middle }, { ...segmentOfType(last, "tangential"), startProgress: middle, endProgress: last.endProgress }] });
      }}><Plus/>Add rule</button>}
    </div>}
  </>;
}

function stepLabel(step: Step, program: AutonomousProgram, project: Project): string {
  switch (step.kind) {
    case "path": return program.paths.find((path) => path.id === step.pathId)?.name || "Path";
    case "wait": return `Wait ${seconds(step.ms)}`;
    case "state": {
      const subsystem = project.subsystems.find((item) => item.id === step.subsystemId);
      const state = subsystem?.states.find((item) => item.id === step.stateId);
      return `${subsystem?.name ?? "Mechanism"}: ${state?.name ?? "state"}`;
    }
    case "together": return "Together";
    case "race": return "Race";
  }
}

/** The routine in time order, timed by the physics estimate, with playback over the field. */
function RoutineTimeline({ project, program, estimate, elapsed, playing, onPlay, onSeek, onSelectPath }: {
  project: Project; program: AutonomousProgram; estimate: RoutineEstimate; elapsed: number; playing: boolean;
  onPlay(): void; onSeek(ms: number): void; onSelectPath(pathId: string): void;
}) {
  const total = estimate.durationMs;
  const over = total - AUTONOMOUS_PERIOD_MS;
  const constants = project.robot.constants;
  return <section className="routine-timeline" aria-label="Routine timeline">
    <div className="timeline-steps">
      {program.routine.map((step) => {
        const entry = estimate.entries.find((item) => item.stepId === step.id);
        const duration = entry ? entry.endMs - entry.startMs : 0;
        const path = step.kind === "path" ? program.paths.find((item) => item.id === step.pathId) : undefined;
        const label = stepLabel(step, program, project);
        return <button key={step.id} className={`timeline-step ${step.kind}`} style={{ flexGrow: Math.max(duration, 1), ...(path ? { borderColor: path.color } : {}) }}
          title={`${label} · ${seconds(duration)}`} aria-label={`${label}, ${seconds(duration)}`}
          onClick={() => { if (entry) onSeek(entry.startMs); if (path) onSelectPath(path.id); }}>
          <span>{label}</span>
        </button>;
      })}
      {total > 0 && <span className="playhead" style={{ left: `${Math.min(100, (elapsed / total) * 100)}%` }} aria-hidden="true"/>}
    </div>
    <div className="timeline-controls">
      <button className="primary" disabled={total === 0 || !!estimate.error} onClick={onPlay}>{playing ? <Pause/> : <Play/>}{playing ? "Pause" : "Play"}</button>
      <button disabled={elapsed === 0} onClick={() => onSeek(0)}><Square/>Reset</button>
      <span className="timeline-time">{seconds(elapsed)} / {seconds(total)}</span>
      <input aria-label="Routine time" type="range" min="0" max={total} value={Math.min(elapsed, total)} onChange={(event) => onSeek(Number(event.target.value))}/>
      <span className={over > 0 ? "chip chip-warning" : "chip chip-muted"} title="Estimated from the robot profile's Pedro speeds, braking and turn rate">
        {over > 0 ? `${seconds(over)} over the 30 s autonomous period` : `Estimate · ${constants ? "your Pedro constants" : "robot profile"}${constants?.tuned === false ? " (untuned)" : ""}`}
      </span>
    </div>
    {estimate.error && <p role="alert">{estimate.error}</p>}
  </section>;
}

export interface PathingWorkspaceProps {
  project: Project;
  program: AutonomousProgram;
  onChange(program: AutonomousProgram): void;
  /** Adds a program to the project and selects it. */
  onAddProgram(program: AutonomousProgram): void;
  onNotice(text: string): void;
}

/**
 * Lumière Pathing Visualizer: draws and edits an autonomous program's paths on the field, timed by
 * the physics estimate. Based on the Pedro Pathing Visualizer (see third_party/pedro-pathing-visualizer).
 */
export function PathingWorkspace({ project, program, onChange, onAddProgram, onNotice }: PathingWorkspaceProps) {
  const [selection, setSelection] = useState<Selection>(() => ({ pathId: program.paths[0]?.id }));
  const [snap, setSnapState] = useState(() => Number(readSetting(storageKey(project.id, "snap")) ?? 1));
  const [fieldImage, setFieldImageState] = useState(() => readSetting(storageKey(project.id, "field")));
  const [addMode, setAddMode] = useState(false);
  const [hover, setHover] = useState<Point | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const { paths } = useMemo(() => resolveProgramPaths(program), [program]);
  const estimate = useMemo(() => estimateRoutine(program, project), [program, project.robot, project.subsystems]);
  const path = program.paths.find((item) => item.id === selection.pathId);
  const profile = path ? estimate.profiles.get(path.id) : undefined;

  const setSnap = (value: number) => { setSnapState(value); writeSetting(storageKey(project.id, "snap"), String(value)); };
  const setFieldImage = (value: string | null) => { setFieldImageState(value); writeSetting(storageKey(project.id, "field"), value); };
  const commit = (next: AutonomousProgram, select?: Selection) => { onChange(next); if (select) setSelection(select); };

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      setElapsed((time) => {
        const next = Math.min(time + delta, estimate.durationMs);
        if (next >= estimate.durationMs) setPlaying(false);
        return next;
      });
    }, 30);
    return () => window.clearInterval(timer);
  }, [playing, estimate.durationMs]);

  const addFromToolbar = () => {
    const { point } = endPose(program);
    const target = snapPoint({ x: point.x + (point.x < 108 ? 24 : -24), y: point.y + (point.y < 108 ? 12 : -12) }, snap);
    const { program: next, pathId } = addPath(program, target);
    commit(next, { pathId });
  };
  const removeSelected = () => {
    if (!path) return;
    if (selection.point?.kind === "control") commit(removeControlPoint(program, path.id, selection.point.index), { pathId: path.id });
    else commit(deletePath(program, path.id), { pathId: undefined });
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (/INPUT|TEXTAREA|SELECT/.test(target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeSelected(); }
    else if (event.key.toLowerCase() === "a" && path) { event.preventDefault(); commit(insertControlPoint(program, path.id), { pathId: path.id }); }
    else if (event.key.toLowerCase() === "w") { event.preventDefault(); setAddMode((mode) => !mode); }
    else if (event.key === " " && target.tagName !== "BUTTON") { event.preventDefault(); if (elapsed >= estimate.durationMs) setElapsed(0); setPlaying((value) => !value); }
    else if (event.key === "Escape") { setSelection({}); setAddMode(false); }
  };
  const importFile = async (file: File) => {
    try {
      const imported = importVisualizer(await file.text(), { robot: project.robot });
      const keeps = program.routine.some((step) => step.kind !== "path" && step.kind !== "wait");
      if (keeps && !(await confirmAction(`Opening ${file.name} replaces this program's paths and routine, including its mechanism steps. You can undo it. Continue?`))) return;
      commit({ ...program, start: imported.start, paths: imported.paths, routine: imported.routine }, { pathId: imported.paths[0]?.id });
      if (imported.warnings.length) onNotice(imported.warnings.join("\n"));
    } catch (error) {
      onNotice(error instanceof Error ? error.message : `Lumière could not read ${file.name}.`);
    }
  };

  return <div className="pathing" onKeyDown={onKeyDown}>
    <div className="pathing-main">
      <div className="inline-actions pathing-toolbar" role="toolbar" aria-label="Path tools">
        <button onClick={addFromToolbar}><Plus/>Add path</button>
        <button className="icon-tool" aria-pressed={addMode} aria-label="Draw paths by clicking" title="Draw paths by clicking the field (W)" onClick={() => setAddMode(!addMode)}><MousePointerClick/></button>
        <button disabled={path?.kind !== "atomic"} onClick={() => path && commit(insertControlPoint(program, path.id), { pathId: path.id })}><Spline/>Add curve handle</button>
        <button title="Reflect this program across the field's center line" onClick={() => commit(mirrorProgram(program))}><FlipHorizontal/>Mirror</button>
        <button className="icon-tool" aria-label="Mirrored copy" title="Add a mirrored copy of this program for the other alliance" onClick={() => onAddProgram({ ...mirrorProgram(program), id: newId("auto"), name: `${program.name} (mirrored)` })}><Copy/></button>
        <button onClick={() => fileInput.current?.click()}><Upload/>Import .pp</button>
        <button onClick={() => {
          const result = exportVisualizer(program, { robot: project.robot });
          download(`${program.name.trim().replace(/[<>:"/\\|?*]/g, "-") || "program"}.pp`, result.text);
          if (result.warnings.length) onNotice(result.warnings.join("\n"));
        }}><Download/>Export .pp</button>
        <label className="compact-select">Snap<select value={snap} onChange={(event) => setSnap(Number(event.target.value))}>
          {SNAP_OPTIONS.map((value) => <option key={value} value={value}>{value ? `${value} in` : "Off"}</option>)}
        </select></label>
        {fieldImage
          ? <button className="icon-tool" aria-label="Remove field image" title="Remove the field image" onClick={() => setFieldImage(null)}><ImageOff/></button>
          : <button className="icon-tool" aria-label="Field image" title="Show your own field image under the paths" onClick={() => imageInput.current?.click()}><Image/></button>}
        <input aria-label="Open a Pedro Pathing .pp file" ref={fileInput} type="file" accept=".pp,.json" hidden onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void importFile(file);
        }}/>
        <input aria-label="Choose a field image" ref={imageInput} type="file" accept="image/*" hidden onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          if (file.size > 3 * 1024 * 1024) { onNotice("Choose a field image up to 3 MB."); return; }
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === "string" && setFieldImage(reader.result);
          reader.readAsDataURL(file);
        }}/>
      </div>
      <div className="pathing-stage">
        <FieldCanvas project={project} program={program} paths={paths} selection={selection} snap={snap} addMode={addMode}
          pose={playing || elapsed > 0 ? estimate.poseAt(elapsed) : undefined} fieldImage={fieldImage}
          onSelect={setSelection} onCommit={commit} onHover={setHover}/>
      </div>
      <p className="pathing-hint" aria-live="polite">
        {hover ? `x ${hover.x.toFixed(1)} · y ${hover.y.toFixed(1)} in` : addMode ? "Click the field to add a path. Press W or Escape to stop." : "Double-click the field to add a path. Drag points; arrow keys nudge by 1 inch, Shift for more."}
      </p>
      <RoutineTimeline project={project} program={program} estimate={estimate} elapsed={elapsed} playing={playing}
        onPlay={() => { if (elapsed >= estimate.durationMs) setElapsed(0); setPlaying(!playing); }}
        onSeek={(ms) => { setPlaying(false); setElapsed(ms); }}
        onSelectPath={(pathId) => setSelection({ pathId })}/>
    </div>
    <aside className="properties pathing-panel" aria-label="Path properties">
      <h2>Start pose</h2>
      <div className="form-pair">
        <NumberField label="Start X (in)" min={0} max={FIELD_INCHES} value={program.start.x} onChange={(x) => commit({ ...program, start: { ...program.start, x } })}/>
        <NumberField label="Start Y (in)" min={0} max={FIELD_INCHES} value={program.start.y} onChange={(y) => commit({ ...program, start: { ...program.start, y } })}/>
      </div>
      <NumberField label="Start heading (°)" value={program.start.headingDeg} onChange={(headingDeg) => commit({ ...program, start: { ...program.start, headingDeg } })}/>

      <h2>Paths</h2>
      {program.paths.length ? <ol className="path-list">
        {program.paths.map((item, index) => <li key={item.id} className={item.id === path?.id ? "selected" : undefined}>
          <button className="path-pick" aria-pressed={item.id === path?.id} onClick={() => setSelection({ pathId: item.id })}>
            <i style={{ background: item.color }} aria-hidden="true"/>
            <span>{item.name || `Path ${index + 1}`}</span>
            <small>{estimate.profiles.has(item.id) ? seconds(estimate.profiles.get(item.id)!.durationMs) : "Not driven"}</small>
          </button>
          <button aria-label={`Move ${item.name || `path ${index + 1}`} up`} disabled={index === 0} onClick={() => commit(movePath(program, item.id, -1))}><ArrowUp/></button>
          <button aria-label={`Move ${item.name || `path ${index + 1}`} down`} disabled={index === program.paths.length - 1} onClick={() => commit(movePath(program, item.id, 1))}><ArrowDown/></button>
        </li>)}
      </ol> : <p className="profile-note">Double-click the field or use Add path to draw the first path.</p>}

      {path && <>
        <h2>Selected path</h2>
        <label>Path name<input value={path.name} onChange={(event) => commit(updatePath(program, path.id, { name: event.target.value }))}/></label>
        <label className="color-field">Color<input type="color" value={path.color} onChange={(event) => commit(updatePath(program, path.id, { color: event.target.value }))}/></label>
        {path.kind === "atomic" ? <>
          <div className="form-pair">
            <NumberField label="End X (in)" min={0} max={FIELD_INCHES} value={path.end.x} onChange={(x) => commit(movePoint(program, { kind: "end", pathId: path.id }, { ...path.end, x }))}/>
            <NumberField label="End Y (in)" min={0} max={FIELD_INCHES} value={path.end.y} onChange={(y) => commit(movePoint(program, { kind: "end", pathId: path.id }, { ...path.end, y }))}/>
          </div>
          {path.controlPoints.map((control, index) => <div className="form-pair control-row" key={index}>
            <NumberField label={`Handle ${index + 1} X`} min={0} max={FIELD_INCHES} value={control.x} onChange={(x) => commit(movePoint(program, { kind: "control", pathId: path.id, index }, { ...control, x }))}/>
            <NumberField label={`Handle ${index + 1} Y`} min={0} max={FIELD_INCHES} value={control.y} onChange={(y) => commit(movePoint(program, { kind: "control", pathId: path.id, index }, { ...control, y }))}/>
            <button aria-label={`Remove handle ${index + 1}`} onClick={() => commit(removeControlPoint(program, path.id, index), { pathId: path.id })}><Trash2/></button>
          </div>)}
          <HeadingEditor heading={path.heading} onChange={(heading) => commit(setHeading(program, path.id, heading))}/>
        </> : <p className="profile-note">This path is a group of {path.segments.length} pieces followed without stopping. Edit its pieces in a .pp file.</p>}
        {profile && <dl className="stream-values profile-values">
          <div><dt>Estimated time</dt><dd>{seconds(profile.durationMs)}</dd></div>
          <div><dt>Top speed</dt><dd>{profile.topSpeed.toFixed(0)} in/s</dd></div>
          {profile.turnMs > 0 && <div><dt>Turns in place first</dt><dd>{seconds(profile.turnMs)}</dd></div>}
        </dl>}
        <button className="danger" onClick={() => commit(deletePath(program, path.id), { pathId: undefined })}><Trash2/>Delete path</button>
      </>}
    </aside>
  </div>;
}
