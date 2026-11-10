import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ChevronDown, Download, Flame, PanelLeft, PanelRight, Settings } from "lucide-react";
import { BRAND } from "../../brand";
import {
  addPath, AUTONOMOUS_PERIOD_MS, buildLiveProgram, deletePath, hasErrors, LIVE_OPMODE_NAME, validateProject, endPose, estimateRoutine, exportVisualizer, GRID_SIZES, importVisualizer, insertControlPoint,
  mirrorProgram, movePath, newId, removeControlPoint, resolveProgramPaths, samplePath, snapToGrid,
  type AutonomousProgram, type Pose, type Program, type Project,
} from "../../core";
import { confirmAction, download } from "../store";
import { FieldView, PlaybackBar, type Overlay, type RunOverlay, type Selection, type Tool } from "./FieldView";
import { Inspector } from "./Inspector";
import { LayersPanel, RoutineSteps, Section } from "./LayersPanel";
import { RunBar, RunPanel, TelemetryPanel, type RunEnvironment } from "./RunPanels";
import { DEFAULT_FIELD, fieldImageSource, isFieldId, type FieldId } from "./fields";
import { useRunSession } from "./useRunSession";
import "./pathing.css";

export type PathingMode = "develop" | "simulate" | "robot";

const storageKey = (projectId: string, name: string) => `lumiere-pathing-${name}:${projectId}`;
function readSetting(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function writeSetting(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* Settings then last for this session. */ }
}
const number = (value: number) => Number(value.toFixed(2)).toString();

type MenuItem = { label: string; run(): void } | "separator";

/** A button that opens a short list of actions, like the Visualizer's File and Export menus. */
function Menu({ label, icon, align = "start", items }: { label: string; icon?: ReactNode; align?: "start" | "end"; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  return <div className="pv-menu" ref={root}>
    <button type="button" className="pv-menu-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
      {icon}<span className={icon ? "pv-narrow-sr" : undefined}>{label}</span><ChevronDown className="pv-caret"/>
    </button>
    {open && <div className={`pv-menu-list ${align}`} role="menu" aria-label={label}>
      {items.map((item, index) => item === "separator"
        ? <div key={index} className="pv-menu-separator" role="separator"/>
        : <button key={item.label} type="button" role="menuitem" onClick={() => { setOpen(false); item.run(); }}>{item.label}</button>)}
    </div>}
  </div>;
}

export interface PathingWorkspaceProps {
  project: Project;
  program: Program;
  /** Develop draws paths; Simulate runs them in the simulator (or plays the estimate on the web); Robot watches the robot. */
  mode: PathingMode;
  onMode(mode: PathingMode): void;
  onChange(program: Program): void;
  /** Adds a program to the project and selects it. */
  onAddProgram(program: Program): void;
  onNotice(text: string): void;
  /** Opens the Robot page. */
  onOpenRobot(): void;
  /** The desktop simulator, the robot's address and deploys. */
  env: RunEnvironment;
}

/**
 * Lumière Pathing Visualizer: a rebuild of the Pedro Pathing Visualizer's workspace that edits the
 * program directly, then runs it in the simulator and on the robot against the plan. See
 * third_party/pedro-pathing-visualizer for the credit.
 */
export function PathingWorkspace({ project, program, mode, onMode, onChange, onAddProgram, onNotice, onOpenRobot, env }: PathingWorkspaceProps) {
  const auto = program.kind === "autonomous" ? program : undefined;
  // A TeleOp has no paths to draw, so it opens in Simulate.
  const shownMode: PathingMode = !auto && mode === "develop" ? "simulate" : mode;
  const develop = shownMode === "develop";
  // The web app can't run Java, so its Simulate plays the estimate.
  const preview = shownMode === "simulate" && !env.desktop;
  const [selection, setSelection] = useState<Selection>(() => ({ pathId: auto?.paths[0]?.id }));
  const [tool, setTool] = useState<Tool>("select");
  const [grid, setGrid] = useState(() => { const saved = Number(readSetting(storageKey(project.id, "grid"))); return GRID_SIZES.includes(saved as typeof GRID_SIZES[number]) ? saved : 0; });
  const [snap, setSnap] = useState(() => readSetting(storageKey(project.id, "snap")) !== "off");
  const [ruler, setRuler] = useState(false);
  const [protractor, setProtractor] = useState(false);
  const [protractorLocked, setProtractorLocked] = useState(true);
  const [overlayIds, setOverlayIds] = useState<string[]>([]);
  const [leftHidden, setLeftHidden] = useState(false);
  const [rightHidden, setRightHidden] = useState(false);
  const [fieldId, setFieldIdState] = useState<FieldId>(() => { const saved = readSetting(storageKey(project.id, "field")); return isFieldId(saved) ? saved : DEFAULT_FIELD; });
  const [customImage, setCustomImageState] = useState(() => readSetting(storageKey(project.id, "field-image")));
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const paths = useMemo(() => (auto ? resolveProgramPaths(auto).paths : []), [auto]);
  const estimate = useMemo(() => (auto ? estimateRoutine(auto, project) : undefined), [auto, project.robot, project.subsystems]);
  const overlays: Overlay[] = useMemo(() => overlayIds.flatMap((id) => {
    const other = project.programs.find((item) => item.id === id);
    if (other?.kind !== "autonomous") return [];
    try { return [{ id, name: other.name, color: other.paths[0]?.color ?? "#9a9a9a", paths: resolveProgramPaths(other).paths }]; } catch { return []; }
  }), [overlayIds, project.programs]);

  // Both connections belong to the workspace, so switching modes keeps them; leaving Pathing or the program closes them.
  const simulator = useRunSession({ source: "simulator", projectId: project.id, programName: program.name, onLog: env.onLog,
    launch: env.launch, cancel: env.cancel, canLaunch: env.canLaunch });
  // Lumière Live gets the program a deploy would generate, so it waits until the project has no errors.
  const liveProgram = useMemo(() => {
    if (!env.live || program.kind !== "autonomous" || hasErrors(validateProject(project))) return null;
    try { return buildLiveProgram(project, program); } catch { return null; }
  }, [env.live, project, program]);
  const robot = useRunSession({ source: "robot", projectId: project.id, programName: program.name, onLog: env.onLog,
    host: env.host, onHost: env.onHost, onScan: env.onScan, live: env.live ? { secret: env.live.secret, program: liveProgram } : undefined });
  const session = shownMode === "robot" ? robot : shownMode === "simulate" && env.desktop ? simulator : undefined;

  // The BIOBUZZ field has light and dark pictures; follow the app's theme when it changes.
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  const fieldImage = useMemo(() => fieldImageSource(fieldId, customImage), [fieldId, customImage, theme]);

  const changeMode = (next: PathingMode) => {
    // The keyboard drives the simulator only while Simulate is in view, so Develop's shortcuts stay shortcuts.
    if (next !== "simulate") simulator.setKeyboard(false);
    setTool("select");
    setPlaying(false);
    onMode(next);
  };
  const commit = (next: AutonomousProgram, select?: Selection) => { onChange(next); if (select) setSelection(select); };
  const setField = (id: FieldId, ask = true) => {
    setFieldIdState(id);
    writeSetting(storageKey(project.id, "field"), id);
    if (ask && id === "custom" && !customImage) imageInput.current?.click();
  };
  const setCustomImage = (value: string | null) => { setCustomImageState(value); writeSetting(storageKey(project.id, "field-image"), value); };
  const cycleGrid = () => {
    const at = GRID_SIZES.indexOf(grid as typeof GRID_SIZES[number]);
    const next = at < 0 ? GRID_SIZES[0] : GRID_SIZES[at + 1] ?? 0;
    setGrid(next);
    writeSetting(storageKey(project.id, "grid"), String(next));
  };
  const toggleSnap = () => { writeSetting(storageKey(project.id, "snap"), snap ? "off" : "on"); setSnap(!snap); };
  const addFromTool = () => {
    if (!auto) return;
    const { point } = endPose(auto);
    const target = snapToGrid({ x: point.x + (point.x < 106 ? 24 : -24), y: point.y + (point.y < 106 ? 12 : -12) }, snap ? grid : 0);
    const { program: next, pathId } = addPath(auto, target);
    commit(next, { pathId });
    setTool("select");
  };
  const duration = estimate?.durationMs ?? 0;
  const play = () => {
    if (!playing && elapsed >= duration) setElapsed(0);
    setPlaying(!playing);
  };
  const seek = (ms: number) => { setPlaying(false); setElapsed(Math.max(0, Math.min(ms, duration))); };

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      setElapsed((time) => {
        const next = time + delta;
        if (next < duration) return next;
        if (loop) return 0;
        setPlaying(false);
        return duration;
      });
    }, 30);
    return () => window.clearInterval(timer);
  }, [playing, loop, duration]);

  const atStart = !playing && elapsed === 0;
  const robotPose = atStart || !estimate || duration === 0 ? undefined : estimate.poseAt(Math.min(elapsed, duration));
  const startPose: Pose | undefined = auto && { x: auto.start.x, y: auto.start.y, heading: (auto.start.headingDeg * Math.PI) / 180 };
  const shownPose = robotPose ?? startPose ?? { x: 0, y: 0, heading: 0 };
  const speed = useMemo(() => {
    if (atStart || !estimate || duration === 0) return 0;
    const before = estimate.poseAt(Math.max(0, elapsed - 25));
    const after = estimate.poseAt(Math.min(duration, elapsed + 25));
    return Math.hypot(after.x - before.x, after.y - before.y) / 0.05;
  }, [atStart, elapsed, estimate, duration]);
  /** Where the plan has each path end, from the estimate. */
  const pathEnds = (label: (name: string) => string) => (auto && estimate ? auto.routine.flatMap((step) => {
    if (step.kind !== "path") return [];
    const entry = estimate.entries.find((item) => item.stepId === step.id);
    const index = auto.paths.findIndex((item) => item.id === step.pathId);
    const path = auto.paths[index];
    return entry && path ? [{ ms: entry.endMs, color: path.color, name: label(path.name || `Path ${index + 1}`) }] : [];
  }) : []);
  const distance = paths.reduce((sum, path) => sum + path.curve.length, 0);

  // Planned against actual: when the run is this program's own OpMode, the estimate's pose at the run's
  // time is drawn as a ghost, and the panel reports how far the robot is from the planned path.
  // A Lumière Live run of the program this computer sent counts as this program's own run.
  const liveRun = !!session && session.source === "robot" && session.active === LIVE_OPMODE_NAME
    && !!liveProgram && session.live?.program?.revision === liveProgram.revision;
  const ownOpMode = !!session && !!auto && (session.active === program.name || liveRun);
  const started = ownOpMode && (session.phase === "running" || session.phase === "stopped");
  const plannedPoints = useMemo(() => paths.flatMap((path) => samplePath(path, 64)), [paths]);
  const actual = session?.pose;
  const offPath = ownOpMode && actual && plannedPoints.length ? Math.min(...plannedPoints.map((point) => Math.hypot(point.x - actual.x, point.y - actual.y))) : undefined;
  // The routine steps the plan has running now: at playback's time, or at the run's time for this program's own run.
  const activeIds = estimate && (session ? started && estimate.activeStepIds(session.elapsed) : !atStart && estimate.activeStepIds(elapsed)) || undefined;
  const run: RunOverlay | undefined = session && {
    actual,
    target: session.target,
    trail: session.trail,
    route: session.route?.map(([x, y]) => ({ x, y })),
    planned: started && estimate && duration > 0 ? estimate.poseAt(Math.min(session.elapsed, duration)) : undefined,
  };

  const importFile = async (file: File) => {
    if (!auto) return;
    try {
      const imported = importVisualizer(await file.text(), { robot: project.robot });
      const keeps = auto.routine.some((step) => step.kind !== "path" && step.kind !== "wait");
      if (keeps && !(await confirmAction(`Opening ${file.name} replaces this program's paths and routine, including its mechanism steps. You can undo it. Continue?`))) return;
      commit({ ...auto, start: imported.start, paths: imported.paths, routine: imported.routine }, { pathId: imported.paths[0]?.id });
      if (imported.warnings.length) onNotice(imported.warnings.join("\n"));
    } catch (error) {
      onNotice(error instanceof Error ? error.message : `Lumière could not read ${file.name}.`);
    }
  };
  const exportFile = () => {
    if (!auto) return;
    const result = exportVisualizer(auto, { robot: project.robot });
    download(`${auto.name.trim().replace(/[<>:"/\\|?*]/g, "-") || "program"}.pp`, result.text);
    if (result.warnings.length) onNotice(result.warnings.join("\n"));
  };
  const copyPoses = () => {
    if (!auto) return;
    const pose = (x: number, y: number, radians: number) => `new Pose(${number(x)}, ${number(y)}, Math.toRadians(${number((((radians * 180) / Math.PI) % 360 + 360) % 360)}))`;
    const lines = [
      `${pose(auto.start.x, auto.start.y, (auto.start.headingDeg * Math.PI) / 180)} // start`,
      ...paths.map((path, index) => { const end = path.poseAt(1); return `${pose(end.x, end.y, end.heading)} // end of ${path.doc.name || `Path ${index + 1}`}`; }),
    ].join("\n");
    navigator.clipboard?.writeText(lines).then(() => onNotice("Copied the start and end poses as Pedro Pose code."), () => onNotice(lines));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (/INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const path = auto?.paths.find((item) => item.id === selection.pathId);
    // View keys work in every mode; editing keys only in Develop.
    if (key === "escape") { setTool("select"); setSelection({}); }
    else if (key === "c") setTool("coordinate");
    else if (key === "g") cycleGrid();
    else if (key === "r") setRuler(!ruler);
    else if (key === " " && target.tagName !== "BUTTON" && (develop || preview) && auto) play();
    else if (!develop || !auto) return;
    else if (key === "p") setTool("pen");
    else if (key === "w") addFromTool();
    else if (key === "a" && path?.kind === "atomic") commit(insertControlPoint(auto, path.id), { pathId: path.id });
    else if ((key === "delete" || key === "backspace") && path) {
      if (selection.point?.kind === "control") commit(removeControlPoint(auto, path.id, selection.point.index), { pathId: path.id });
      else commit(deletePath(auto, path.id), {});
    } else return;
    event.preventDefault();
  };

  const modes: { id: PathingMode; label: string; hint: string; live?: boolean }[] = [
    { id: "develop", label: "Develop", hint: auto ? "Draw and edit the paths, timed by the estimate" : "TeleOp programs have no paths to draw" },
    { id: "simulate", label: "Simulate", hint: env.desktop ? "Run your Java in the simulator" : "Play the estimate on the field", live: simulator.linked },
    { id: "robot", label: "Robot", hint: "Watch the robot run against the plan", live: robot.linked },
  ];
  const leftLabel = develop ? "layers" : "controls";
  const rightLabel = develop ? "inspector" : "telemetry";
  return <div className="pathing" tabIndex={-1} onKeyDown={onKeyDown}>
    <header className="pv-topbar">
      <div className="pv-brand">
        <span className="pv-mark" aria-hidden="true"><Flame/></span>
        <div className="pv-title"><h1>{BRAND.name} Pathing Visualizer</h1><small>Based on the Pedro Pathing Visualizer</small></div>
      </div>
      {auto && <Menu label="File" items={[
        { label: "Import a .pp file…", run: () => fileInput.current?.click() },
        "separator",
        { label: "Mirror to the other alliance", run: () => commit(mirrorProgram(auto)) },
        { label: "Mirrored copy as a new program", run: () => onAddProgram({ ...mirrorProgram(auto), id: newId("auto"), name: `${auto.name} (mirrored)` }) },
      ]}/>}
      <span className="pv-program" title={`The ${auto ? "autonomous" : "TeleOp"} program in view. Rename it in the sidebar.`}>{program.name || "Unnamed program"}</span>
      <div className="pv-modes" role="group" aria-label="Mode">
        {modes.map((item) => <button key={item.id} type="button" aria-pressed={shownMode === item.id} title={item.hint}
          disabled={item.id === "develop" && !auto} onClick={() => changeMode(item.id)}>
          {item.label}{item.live && <><i className="pv-live" aria-hidden="true"/><span className="pv-sr"> (connected)</span></>}
        </button>)}
      </div>
      <div className="pv-topbar-actions">
        {auto && <Menu label="Export" icon={<Download/>} align="end" items={[
          { label: "Pedro Pathing file (.pp)", run: exportFile },
          { label: "Copy poses as Pedro code", run: copyPoses },
        ]}/>}
        {develop && <button type="button" className="pv-icon" aria-label="Start, field and robot" title="Start, field and robot"
          onClick={() => { setSelection({}); setRightHidden(false); }}><Settings/></button>}
      </div>
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
        reader.onload = () => { if (typeof reader.result === "string") { setCustomImage(reader.result); setField("custom", false); } };
        reader.readAsDataURL(file);
      }}/>
    </header>
    <div className={`pv-layout${leftHidden ? " left-hidden" : ""}${rightHidden ? " right-hidden" : ""}`}>
      {leftHidden
        ? <button type="button" className="pv-restore" aria-label={`Show ${leftLabel}`} title={`Show ${leftLabel}`} onClick={() => setLeftHidden(false)}><PanelLeft/></button>
        : develop && auto && estimate
          ? <LayersPanel project={project} program={auto} estimate={estimate} selectedPathId={selection.pathId} overlayIds={overlayIds}
            robotPose={shownPose} speed={speed} activeIds={activeIds}
            onSelectPath={(pathId) => setSelection({ pathId })} onAddPath={addFromTool}
            onMovePath={(pathId, by) => commit(movePath(auto, pathId, by))}
            onToggleOverlay={(id) => setOverlayIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id].slice(-4)))}
            onHide={() => setLeftHidden(true)}/>
          : <RunPanel mode={shownMode === "robot" ? "robot" : "simulate"} session={session} project={project} program={program} env={env} liveProgram={liveProgram} onHide={() => setLeftHidden(true)}
            routine={auto && estimate && <Section title="Plan" count={auto.routine.length}><RoutineSteps project={project} program={auto} estimate={estimate} activeIds={activeIds}/></Section>}/>}
      <section className="pv-panel pv-field-panel" aria-label="Field">
        <FieldView project={project} program={auto} paths={paths} overlays={develop ? overlays : []} selection={selection} tool={tool} editable={develop}
          grid={grid} snap={snap} ruler={ruler} protractor={protractor} protractorLocked={protractorLocked}
          fieldImage={fieldImage} robotPose={develop || preview ? robotPose : undefined} run={run}
          onTool={setTool} onCycleGrid={cycleGrid} onSnap={toggleSnap} onRuler={() => setRuler(!ruler)} onProtractor={() => setProtractor(!protractor)}
          onProtractorLock={() => setProtractorLocked(!protractorLocked)} onSelect={setSelection} onCommit={commit} onAddPath={addFromTool} onNotice={onNotice}/>
        {session
          ? <RunBar session={session} limitMs={session.source === "simulator" ? session.limit * 1000 : auto ? AUTONOMOUS_PERIOD_MS : 120_000}
            markers={pathEnds((name) => `Planned end of ${name}`)}/>
          : auto && estimate && <PlaybackBar elapsed={elapsed} duration={duration} playing={playing} loop={loop} markers={pathEnds((name) => `Jump to the end of ${name}`)}
            distance={distance} overBy={duration - AUTONOMOUS_PERIOD_MS} onPlay={play} onLoop={() => setLoop(!loop)} onSeek={seek}/>}
        {!session && estimate?.error && <p className="pv-error" role="alert">{estimate.error}</p>}
      </section>
      {rightHidden
        ? <button type="button" className="pv-restore" aria-label={`Show ${rightLabel}`} title={`Show ${rightLabel}`} onClick={() => setRightHidden(false)}><PanelRight/></button>
        : develop && auto && estimate
          ? <Inspector project={project} program={auto} selection={selection} profiles={estimate.profiles} fieldId={fieldId} customImage={customImage}
            onField={setField} onCustomImage={() => imageInput.current?.click()} onCommit={commit} onSelect={setSelection} onOpenRobot={onOpenRobot}
            onHide={() => setRightHidden(true)}/>
          : <TelemetryPanel session={session} project={project} program={program} estimated={preview && auto ? { pose: shownPose, speed } : undefined}
            offPath={offPath} onHide={() => setRightHidden(true)}/>}
    </div>
  </div>;
}
