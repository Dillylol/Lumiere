import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Crosshair, Grid3x3, Lock, LockOpen, Magnet, MousePointer2, Pause, PenTool, Play, Plus, Repeat, Ruler } from "lucide-react";
import {
  addPath, addPenPath, FIELD_FLOOR_INCHES, FIELD_IMAGE_OVERHANG, gridLines, movePoint, resolveProgramPaths, samplePath, snapToGrid,
  TILE_INCHES, type AutonomousProgram, type Point, type PointRef, type Pose, type Project, type ResolvedPath,
} from "../../core";

export type Tool = "select" | "pen" | "coordinate";
export type Selection = { pathId?: string; point?: PointRef };
export interface Overlay { id: string; name: string; color: string; paths: ResolvedPath[] }
/** What a simulator or robot run shows over the plan. */
export interface RunOverlay {
  /** Where the estimate puts the robot at this point of the run, drawn as a ghost. */
  planned?: Pose;
  /** The robot's reported pose. */
  actual?: Pose;
  /** Where the robot has driven since START. */
  trail?: Point[];
  /** The path the follower reports following, and its target pose. */
  route?: Point[];
  target?: Pose;
}

const F = FIELD_FLOOR_INCHES;
const LINE = 0.57;
const POINT = 1;
const sameRef = (a: PointRef | undefined, b: PointRef) => !!a && a.kind === b.kind
  && (a.kind === "start" || (b.kind !== "start" && a.pathId === b.pathId && (a.kind === "end" || (b.kind === "control" && a.index === b.index))));
const polyline = (points: Point[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
const listed = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** An angle: the protractor's icon. */
function AngleIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 20h16M4 20 13 6"/><path d="M9 20a5 5 0 0 0-2-4"/>
  </svg>;
}

/**
 * The robot drawn as the Visualizer's sprite: side bumpers with hatched corners, cross rails, a center
 * mark and a chevron pointing forward. Length runs along the heading.
 */
export function RobotSprite({ pose, length, width, ghost = false, arrow = true }: { pose: Pose; length: number; width: number; ghost?: boolean; arrow?: boolean }) {
  const l = length / 2;
  const w = width / 2;
  const bar = Math.min(3.6, width * 0.2);
  const end = Math.min(5, length * 0.28);
  return <g className={ghost ? "pv-robot ghost" : "pv-robot"} transform={`translate(${pose.x} ${pose.y}) rotate(${(pose.heading * 180) / Math.PI})`} pointerEvents="none">
    <rect x={-l} y={-w} width={length} height={width} className="pv-robot-body"/>
    {[w - bar, -w].map((y) => <g key={y}>
      <rect x={-l} y={y} width={length} height={bar} className="pv-robot-bar"/>
      <rect x={-l} y={y} width={end} height={bar} className="pv-robot-hatch"/>
      <rect x={l - end} y={y} width={end} height={bar} className="pv-robot-hatch"/>
    </g>)}
    {[-l * 0.62, l * 0.62].map((x) => <line key={x} x1={x} y1={-w + bar} x2={x} y2={w - bar} className="pv-robot-rail"/>)}
    <circle r=".55" className="pv-robot-center"/>
    <path d={`M${l * 0.22} ${-1.1}L${l * 0.22 + 1.1} 0L${l * 0.22} 1.1`} className="pv-robot-chevron"/>
    {arrow && !ghost && <line x1="0" y1="0" x2={l + 4} y2="0" className="pv-robot-arrow" markerEnd="url(#pv-arrowhead)"/>}
  </g>;
}

interface FieldViewProps {
  project: Project;
  /** The autonomous program to draw; a TeleOp has none. */
  program?: AutonomousProgram;
  paths: ResolvedPath[];
  overlays: Overlay[];
  selection: Selection;
  tool: Tool;
  /** Develop edits the paths; Simulate and Robot only show them. */
  editable?: boolean;
  grid: number;
  snap: boolean;
  ruler: boolean;
  protractor: boolean;
  protractorLocked: boolean;
  fieldImage: string | null;
  /** Where playback has the robot; the start pose when playback is at the beginning. */
  robotPose?: Pose;
  /** A simulator or robot run, drawn over the plan. */
  run?: RunOverlay;
  onTool(tool: Tool): void;
  onCycleGrid(): void;
  onSnap(): void;
  onRuler(): void;
  onProtractor(): void;
  onProtractorLock(): void;
  onSelect?(selection: Selection): void;
  onCommit?(program: AutonomousProgram, select?: Selection): void;
  onAddPath?(): void;
  onNotice(text: string): void;
}

type Drag =
  | { kind: "point"; ref: PointRef; moved: boolean }
  | { kind: "pen"; points: Point[] }
  | { kind: "ruler"; end: 0 | 1 }
  | { kind: "protractor"; part: "center" | "arm" };

/**
 * The field panel's stage: tool rails, the field with its paths and robot, and the measuring tools.
 * A drag previews its edit here and commits once, so each drag is one undo step.
 */
export function FieldView(props: FieldViewProps) {
  const { project, program, paths, overlays, selection, grid, snap, ruler, protractor, protractorLocked, fieldImage, robotPose, run } = props;
  const editable = props.editable !== false && !!program;
  // The pen and adding paths are editing tools, so only Develop offers them.
  const tool: Tool = !editable && props.tool === "pen" ? "select" : props.tool;
  const stage = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | undefined>(undefined);
  const [size, setSize] = useState(480);
  const [draft, setDraft] = useState<AutonomousProgram>();
  const [pen, setPen] = useState<Point[]>([]);
  const [hover, setHover] = useState<Point | null>(null);
  const [copied, setCopied] = useState(false);
  const [rulerEnds, setRulerEnds] = useState<[Point, Point]>([{ x: 40.75, y: 70.75 }, { x: 100.75, y: 70.75 }]);
  const [protractorCenter, setProtractorCenter] = useState<Point>({ x: 70.75, y: 70.75 });
  const [armDeg, setArmDeg] = useState(90);
  const shown = draft ?? program;
  const shownPaths = draft ? resolveProgramPaths(draft).paths : paths;
  const { lengthInches: length, widthInches: width } = project.robot;
  const startPose: Pose | undefined = shown && { x: shown.start.x, y: shown.start.y, heading: (shown.start.headingDeg * Math.PI) / 180 };
  // The robot the measuring tools follow: the run's robot, playback's, or the start pose.
  const robot = run ? run.actual ?? run.planned ?? startPose : robotPose ?? startPose;
  const center = protractorLocked && robot ? robot : protractorCenter;
  const place = (point: Point) => snapToGrid(point, snap && grid > 0 ? grid : 0);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    // Keep the field clear of the tool rails (48 px each side) so they never cover a corner, unless the
    // stage is too narrow to spare the room.
    const observer = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      setSize(Math.max(160, Math.floor(Math.min(w - (w >= 480 ? 104 : 16), h - 16))));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const toField = (event: { clientX: number; clientY: number }): Point => {
    const element = svg.current!;
    const point = element.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(element.getScreenCTM()!.inverse());
    return { x: local.x, y: F - local.y };
  };
  const begin = (event: ReactPointerEvent, next: Drag) => {
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    drag.current = next;
  };
  const grabPoint = (event: ReactPointerEvent, ref: PointRef, pathId?: string) => {
    if (tool !== "select" || event.button !== 0) return;
    begin(event, { kind: "point", ref, moved: false });
    props.onSelect?.({ pathId: pathId ?? selection.pathId, point: ref });
  };
  const nudge = (event: ReactKeyboardEvent, ref: PointRef, at: Point) => {
    const step = event.shiftKey ? 6 : 1;
    const delta = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[event.key];
    if (!delta || !program) return;
    event.preventDefault();
    event.stopPropagation();
    props.onCommit?.(movePoint(program, ref, snapToGrid({ x: at.x + delta[0], y: at.y + delta[1] }, 0)));
  };
  const marker = (ref: PointRef, label: string, at: Point, pathId?: string) => editable ? {
    role: "button" as const, tabIndex: 0, "aria-label": label,
    className: sameRef(selection.point, ref) ? "pv-handle selected" : "pv-handle",
    onPointerDown: (event: ReactPointerEvent) => grabPoint(event, ref, pathId),
    onKeyDown: (event: ReactKeyboardEvent) => nudge(event, ref, at),
  } : { className: "pv-fixed" };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const point = toField(event);
    if (tool === "pen") {
      begin(event, { kind: "pen", points: [point] });
      setPen([point]);
    } else if (tool === "coordinate") {
      const text = `${point.x.toFixed(2)}, ${point.y.toFixed(2)}`;
      void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); }, () => props.onNotice(`Coordinate: ${text}`));
    } else {
      props.onSelect?.({});
    }
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = toField(event);
    setHover(point.x >= 0 && point.x <= F && point.y >= 0 && point.y <= F ? point : null);
    const current = drag.current;
    if (!current) return;
    if (current.kind === "point" && program) {
      current.moved = true;
      setDraft(movePoint(draft ?? program, current.ref, place(point)));
    } else if (current.kind === "pen") {
      current.points.push(point);
      setPen([...current.points]);
    } else if (current.kind === "ruler") {
      const placed = place(point);
      setRulerEnds((ends) => current.end === 0 ? [placed, ends[1]] : [ends[0], placed]);
    } else if (current.kind === "protractor" && current.part === "center") {
      setProtractorCenter(place(point));
    } else if (current.kind === "protractor") {
      const deg = (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
      setArmDeg(((Math.round(deg) % 360) + 360) % 360);
    }
  };
  const onPointerUp = () => {
    const current = drag.current;
    drag.current = undefined;
    if (current?.kind === "point" && current.moved && draft) props.onCommit?.(draft);
    if (current?.kind === "pen" && program) {
      const added = addPenPath(program, current.points);
      if (added) props.onCommit?.(added.program, { pathId: added.pathId });
      setPen([]);
    }
    setDraft(undefined);
  };

  const rulerLength = Math.hypot(rulerEnds[1].x - rulerEnds[0].x, rulerEnds[1].y - rulerEnds[0].y);
  const armRad = (armDeg * Math.PI) / 180;
  // Inches per screen pixel. The measuring tools, labels and grab targets keep a steady size on
  // screen, as in the Visualizer, while paths and the robot scale with the field.
  const unit = F / size;
  const px = (pixels: number) => pixels * unit;
  const labelStyle = (pixels: number) => ({ fontSize: px(pixels), strokeWidth: px(3) });
  const radius = px(72);
  const toSvg = (point: Point) => ({ x: point.x, y: F - point.y });
  const imageInset = `${(-FIELD_IMAGE_OVERHANG / F) * 100}%`;
  const imageExtent = `${((F + 2 * FIELD_IMAGE_OVERHANG) / F) * 100}%`;
  const toolButton = (id: Tool, label: string, icon: ReactNode) =>
    <button type="button" className={tool === id ? "pv-icon active" : "pv-icon"} aria-label={label} title={label} aria-pressed={tool === id} onClick={() => props.onTool(id)}>{icon}</button>;
  const runShows = run ? [
    run.actual && "the robot's position",
    run.trail && run.trail.length > 1 && "where it has driven",
    run.route && run.route.length > 1 && "the path the robot is following",
    run.target && "the follower's target pose",
    run.planned && "where the plan has the robot now",
  ].filter((item): item is string => !!item) : [];

  return <div className="pv-stage" ref={stage}>
    <div className="pv-rail pv-rail-left" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {toolButton("select", "Select (Esc)", <MousePointer2/>)}
      {editable && toolButton("pen", "Pen: draw a path (P)", <PenTool/>)}
      {toolButton("coordinate", "Pick a coordinate (C)", <Crosshair/>)}
      {editable && <>
        <span className="pv-rail-divider"/>
        <button type="button" className="pv-icon" aria-label="Add path (W)" title="Add path (W)" onClick={props.onAddPath}><Plus/></button>
      </>}
    </div>
    <div className="pv-rail pv-rail-right" role="toolbar" aria-label="Field view" aria-orientation="vertical">
      <button type="button" className={grid ? "pv-icon active" : "pv-icon"} aria-label={grid ? `Grid: ${grid} in (G for the next size)` : "Grid (G)"} title={grid ? `Grid: ${grid} in (G for the next size)` : "Grid (G)"} aria-pressed={grid > 0} onClick={props.onCycleGrid}>
        <Grid3x3/>{grid > 0 && <span className="pv-badge">{grid}</span>}
      </button>
      {grid > 0 && <button type="button" className={snap ? "pv-icon active" : "pv-icon"} aria-label={snap ? "Snapping to the grid" : "Snap to the grid"} title={snap ? "Snapping to the grid" : "Snap to the grid"} aria-pressed={snap} onClick={props.onSnap}><Magnet/></button>}
      <button type="button" className={ruler ? "pv-icon active" : "pv-icon"} aria-label="Ruler (R)" title="Ruler (R)" aria-pressed={ruler} onClick={props.onRuler}><Ruler/></button>
      <button type="button" className={protractor ? "pv-icon active" : "pv-icon"} aria-label="Protractor" title="Protractor" aria-pressed={protractor} onClick={props.onProtractor}><AngleIcon/></button>
      {protractor && <button type="button" className={protractorLocked ? "pv-icon active" : "pv-icon"} aria-label={protractorLocked ? "Protractor follows the robot" : "Protractor stays put"} title={protractorLocked ? "Protractor follows the robot" : "Protractor stays put"} aria-pressed={protractorLocked} onClick={props.onProtractorLock}>{protractorLocked ? <Lock/> : <LockOpen/>}</button>}
    </div>

    <div className="pv-field" style={{ width: size, height: size }}>
      {fieldImage
        ? <img className="pv-field-image" src={fieldImage} alt="Field" draggable={false} style={{ left: imageInset, top: imageInset, width: imageExtent, height: imageExtent }}/>
        : <div className="pv-field-plain" aria-hidden="true"/>}
      <svg ref={svg} viewBox={`0 0 ${F} ${F}`} className={`pv-scene tool-${tool}${drag.current?.kind === "point" ? " dragging" : ""}${run ? " running" : ""}`}
        role="group" aria-label={`Field, ${F} inches square`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onLostPointerCapture={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={(event) => {
          if (tool !== "select" || !editable || !program) return;
          const { program: next, pathId } = addPath(program, place(toField(event)));
          props.onCommit?.(next, { pathId });
        }}>
        <defs>
          <pattern id="pv-hatch" width="1.4" height="1.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="1.4" className="pv-hatch-line"/>
          </pattern>
          <marker id="pv-arrowhead" markerWidth="10" markerHeight="10" refX="6.5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
            <polygon points="0 0, 7 3, 0 6" transform="scale(.35)" className="pv-arrowhead"/>
          </marker>
        </defs>
        <g transform={`matrix(1 0 0 -1 0 ${F})`}>
          {!fieldImage && Array.from({ length: 7 }, (_, i) => i * TILE_INCHES - FIELD_IMAGE_OVERHANG).filter((at) => at > 0 && at < F).map((at) =>
            <g key={at} className="pv-seam"><line x1={at} y1="0" x2={at} y2={F}/><line x1="0" y1={at} x2={F} y2={at}/></g>)}
          {grid > 0 && <g className="pv-grid">{gridLines(grid).map((at) => <g key={at}><line x1={at} y1="0" x2={at} y2={F}/><line x1="0" y1={at} x2={F} y2={at}/></g>)}</g>}

          {overlays.map((overlay) => <g key={overlay.id} className="pv-overlay" aria-label={`Overlay: ${overlay.name}`}>
            {overlay.paths.map((path) => <polyline key={path.doc.id} points={polyline(samplePath(path, 64))} stroke={overlay.color} strokeWidth={LINE}/>)}
          </g>)}

          <g className={run ? "pv-plan planned" : "pv-plan"}>
            {shownPaths.map((path) => <g key={path.doc.id} className={editable && path.doc.id === selection.pathId ? "pv-path selected" : "pv-path"}>
              {editable && <polyline points={polyline(samplePath(path, 96))} className="pv-path-hit" strokeWidth={px(12)}
                onPointerDown={(event) => { if (tool !== "select" || event.button !== 0) return; event.stopPropagation(); props.onSelect?.({ pathId: path.doc.id }); }}/>}
              <polyline points={polyline(samplePath(path, 96))} stroke={path.doc.color} strokeWidth={editable && path.doc.id === selection.pathId ? LINE * 1.5 : LINE} className="pv-path-line"/>
            </g>)}

            {editable && shownPaths.map((path, index) => {
              if (path.doc.kind !== "atomic" || path.doc.id !== selection.pathId) return null;
              return <g key={`${path.doc.id}-controls`}>
                <polyline points={polyline([path.start, ...path.doc.controlPoints, path.end])} className="pv-control-polygon" stroke={path.doc.color}/>
                {path.doc.controlPoints.map((control, c) => <circle key={c} cx={control.x} cy={control.y} r={Math.max(POINT * 0.85, px(4))} stroke={path.doc.color}
                  {...marker({ kind: "control", pathId: path.doc.id, index: c }, `Control point ${c + 1} of path ${index + 1}`, control, path.doc.id)} data-kind="control"/>)}
              </g>;
            })}

            {shown && <circle cx={shown.start.x} cy={shown.start.y} r={Math.max(POINT, px(4.5))} fill={shownPaths[0]?.doc.color ?? "var(--accent)"} {...marker({ kind: "start" }, "Start pose", shown.start)}/>}
            {shownPaths.map((path, index) => path.doc.kind === "atomic"
              ? <circle key={`${path.doc.id}-end`} cx={path.end.x} cy={path.end.y} r={editable && path.doc.id === selection.pathId ? Math.max(POINT * 1.5, px(6)) : Math.max(POINT, px(4.5))} fill={path.doc.color}
                {...marker({ kind: "end", pathId: path.doc.id }, `Waypoint ${index + 1}`, path.end, path.doc.id)}/>
              : <circle key={`${path.doc.id}-end`} cx={path.end.x} cy={path.end.y} r={Math.max(POINT, px(4.5))} fill={path.doc.color} className="pv-fixed"/>)}
          </g>

          {run ? <g className="pv-run" role="img" aria-label={runShows.length ? `Run view showing ${listed(runShows)}` : "Run view: waiting for the robot's position"}>
            {run.trail && run.trail.length > 1 && <polyline points={polyline(run.trail)} className="pv-trail" strokeWidth={px(2.5)}/>}
            {run.route && run.route.length > 1 && <g className="pv-route">
              <polyline points={polyline(run.route)} strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`}/>
              <circle cx={run.route[run.route.length - 1].x} cy={run.route[run.route.length - 1].y} r={px(4)} strokeWidth={px(1.5)}/>
            </g>}
            {run.planned && <RobotSprite pose={run.planned} length={length} width={width} ghost/>}
            {!run.actual && !run.planned && startPose && <RobotSprite pose={startPose} length={length} width={width} ghost/>}
            {run.actual && <RobotSprite pose={run.actual} length={length} width={width}/>}
            {run.target && <g className="pv-target" transform={`translate(${run.target.x} ${run.target.y}) rotate(${(run.target.heading * 180) / Math.PI})`}>
              <circle r={px(9)} strokeWidth={px(1.5)} strokeDasharray={`${px(4)} ${px(3)}`}/>
              <line x1="0" y1="0" x2={px(16)} y2="0" strokeWidth={px(1.5)}/>
              <circle r={px(2)} className="pv-target-center"/>
            </g>}
          </g> : robot && <RobotSprite pose={robot} length={length} width={width}/>}

          {pen.length > 1 && <polyline points={polyline(pen)} className="pv-pen-preview"/>}

          {ruler && <g className="pv-ruler">
            <line x1={rulerEnds[0].x} y1={rulerEnds[0].y} x2={rulerEnds[1].x} y2={rulerEnds[1].y} strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`}/>
            {rulerEnds.map((end, i) => <circle key={i} cx={end.x} cy={end.y} r={px(5.5)} strokeWidth={px(1.5)} role="button" aria-label={`Ruler end ${i + 1}`}
              onPointerDown={(event) => event.button === 0 && begin(event, { kind: "ruler", end: i as 0 | 1 })}/>)}
          </g>}

          {protractor && <g className="pv-protractor">
            <circle cx={center.x} cy={center.y} r={radius} strokeWidth={px(1.5)} className="pv-protractor-dial"/>
            {Array.from({ length: 36 }, (_, i) => i * 10).map((deg) => {
              const rad = (deg * Math.PI) / 180;
              const inner = radius - px(deg % 30 === 0 ? 10 : 5);
              return <line key={deg} x1={center.x + Math.cos(rad) * inner} y1={center.y + Math.sin(rad) * inner} x2={center.x + Math.cos(rad) * radius} y2={center.y + Math.sin(rad) * radius}
                strokeWidth={px(deg % 30 === 0 ? 1.5 : 1)}/>;
            })}
            <line x1={center.x} y1={center.y} x2={center.x + radius + px(6)} y2={center.y} strokeWidth={px(1.5)} className="pv-protractor-zero"/>
            <line x1={center.x} y1={center.y} x2={center.x + Math.cos(armRad) * (radius + px(6))} y2={center.y + Math.sin(armRad) * (radius + px(6))} strokeWidth={px(2.5)} className="pv-protractor-arm"/>
            <circle cx={center.x + Math.cos(armRad) * radius} cy={center.y + Math.sin(armRad) * radius} r={px(7)} strokeWidth={px(1.5)} className="pv-protractor-handle" role="button" aria-label="Protractor arm"
              onPointerDown={(event) => event.button === 0 && begin(event, { kind: "protractor", part: "arm" })}/>
            {!protractorLocked && <circle cx={center.x} cy={center.y} r={px(6)} strokeWidth={px(1.5)} className="pv-protractor-center" role="button" aria-label="Protractor center"
              onPointerDown={(event) => event.button === 0 && begin(event, { kind: "protractor", part: "center" })}/>}
          </g>}
        </g>

        {ruler && (() => {
          const middle = toSvg({ x: (rulerEnds[0].x + rulerEnds[1].x) / 2, y: (rulerEnds[0].y + rulerEnds[1].y) / 2 });
          return <text x={middle.x} y={middle.y - px(9)} className="pv-label" style={labelStyle(12)} textAnchor="middle">{rulerLength.toFixed(2)}″</text>;
        })()}
        {protractor && <>
          {Array.from({ length: 12 }, (_, i) => i * 30).map((deg) => {
            const rad = (deg * Math.PI) / 180;
            const at = toSvg({ x: center.x + Math.cos(rad) * (radius - px(22)), y: center.y + Math.sin(rad) * (radius - px(22)) });
            return <text key={deg} x={at.x} y={at.y + px(3.5)} className="pv-label" style={labelStyle(10)} textAnchor="middle">{deg}°</text>;
          })}
          {(() => { const at = toSvg({ x: center.x, y: center.y + radius + px(10) }); return <text x={at.x} y={at.y} className="pv-label" style={labelStyle(13)} textAnchor="middle">{armDeg}°</text>; })()}
        </>}
      </svg>
      {tool === "coordinate" && hover && <div className="pv-coordinate" style={{ left: `${(hover.x / F) * 100}%`, top: `${((F - hover.y) / F) * 100}%` }}>
        <span>+</span>{copied ? "Copied" : `${hover.x.toFixed(2)}, ${hover.y.toFixed(2)}`}
      </div>}
    </div>
  </div>;
}

/** Play, loop and scrub the routine; dots on the track mark where each path ends. */
export function PlaybackBar({ elapsed, duration, playing, loop, markers, distance, overBy, onPlay, onLoop, onSeek }: {
  elapsed: number; duration: number; playing: boolean; loop: boolean; distance: number; overBy: number;
  markers: { ms: number; color: string; name: string }[];
  onPlay(): void; onLoop(): void; onSeek(ms: number): void;
}) {
  const percent = (ms: number) => (duration > 0 ? Math.min(100, (ms / duration) * 100) : 0);
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  return <div className="pv-playback">
    <button type="button" className="pv-icon pv-play" aria-label={playing ? "Pause (Space)" : "Play (Space)"} title={playing ? "Pause (Space)" : "Play (Space)"} disabled={duration === 0} onClick={onPlay}>{playing ? <Pause/> : <Play/>}</button>
    <button type="button" className={loop ? "pv-icon active" : "pv-icon"} aria-label={loop ? "Looping" : "Loop"} title={loop ? "Looping" : "Loop"} aria-pressed={loop} onClick={onLoop}><Repeat/></button>
    <div className="pv-track">
      <div className="pv-track-fill" style={{ width: `${percent(elapsed)}%` }}/>
      {markers.map((marker, index) => <button key={index} type="button" className="pv-marker" style={{ left: `${percent(marker.ms)}%`, background: marker.color }}
        title={marker.name} aria-label={marker.name} onClick={() => onSeek(marker.ms)}/>)}
      <input type="range" aria-label="Playback position" min="0" max={Math.max(duration, 1)} step="any" value={Math.min(elapsed, duration)} onChange={(event) => onSeek(Number(event.target.value))}/>
    </div>
    <div className="pv-time" title={overBy > 0 ? `${seconds(overBy)} over the 30 s autonomous period` : "Estimated from the robot profile"}>
      <b>{seconds(elapsed)}</b> / <span className={overBy > 0 ? "over" : undefined}>{seconds(duration)}</span> · {distance.toFixed(0)} in
    </div>
  </div>;
}
