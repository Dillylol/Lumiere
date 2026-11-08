import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ChevronDown, Download, Flame, PanelLeft, PanelRight, Play, Settings } from "lucide-react";
import { BRAND } from "../../brand";
import {
  addPath, AUTONOMOUS_PERIOD_MS, deletePath, endPose, estimateRoutine, exportVisualizer, GRID_SIZES, importVisualizer, insertControlPoint,
  mirrorProgram, movePath, newId, removeControlPoint, resolveProgramPaths, snapToGrid,
  type AutonomousProgram, type Project,
} from "../../core";
import { confirmAction, download } from "../store";
import { FieldView, PlaybackBar, type Overlay, type Selection, type Tool } from "./FieldView";
import { Inspector } from "./Inspector";
import { LayersPanel } from "./LayersPanel";
import { DEFAULT_FIELD, fieldImageSource, isFieldId, type FieldId } from "./fields";
import "./pathing.css";

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
  program: AutonomousProgram;
  onChange(program: AutonomousProgram): void;
  /** Adds a program to the project and selects it. */
  onAddProgram(program: AutonomousProgram): void;
  onNotice(text: string): void;
  /** Opens Simulate. */
  onPreview(): void;
  /** Opens the Robot page. */
  onOpenRobot(): void;
}

/**
 * Lumière Pathing Visualizer: a rebuild of the Pedro Pathing Visualizer's workspace that edits the
 * program directly. Layers on the left, the field with its tool rails and playback in the middle, and
 * the inspector on the right. See third_party/pedro-pathing-visualizer for the credit.
 */
export function PathingWorkspace({ project, program, onChange, onAddProgram, onNotice, onPreview, onOpenRobot }: PathingWorkspaceProps) {
  const [selection, setSelection] = useState<Selection>(() => ({ pathId: program.paths[0]?.id }));
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
  const { paths } = useMemo(() => resolveProgramPaths(program), [program]);
  const estimate = useMemo(() => estimateRoutine(program, project), [program, project.robot, project.subsystems]);
  const overlays: Overlay[] = useMemo(() => overlayIds.flatMap((id) => {
    const other = project.programs.find((item) => item.id === id);
    if (other?.kind !== "autonomous") return [];
    try { return [{ id, name: other.name, color: other.paths[0]?.color ?? "#9a9a9a", paths: resolveProgramPaths(other).paths }]; } catch { return []; }
  }), [overlayIds, project.programs]);

  // The BIOBUZZ field has light and dark pictures; follow the app's theme when it changes.
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  const fieldImage = useMemo(() => fieldImageSource(fieldId, customImage), [fieldId, customImage, theme]);

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
    const { point } = endPose(program);
    const target = snapToGrid({ x: point.x + (point.x < 106 ? 24 : -24), y: point.y + (point.y < 106 ? 12 : -12) }, snap ? grid : 0);
    const { program: next, pathId } = addPath(program, target);
    commit(next, { pathId });
    setTool("select");
  };
  const play = () => {
    if (!playing && elapsed >= estimate.durationMs) setElapsed(0);
    setPlaying(!playing);
  };
  const seek = (ms: number) => { setPlaying(false); setElapsed(Math.max(0, Math.min(ms, estimate.durationMs))); };

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      setElapsed((time) => {
        const next = time + delta;
        if (next < estimate.durationMs) return next;
        if (loop) return 0;
        setPlaying(false);
        return estimate.durationMs;
      });
    }, 30);
    return () => window.clearInterval(timer);
  }, [playing, loop, estimate.durationMs]);

  const atStart = !playing && elapsed === 0;
  const robotPose = atStart || estimate.durationMs === 0 ? undefined : estimate.poseAt(Math.min(elapsed, estimate.durationMs));
  const shownPose = robotPose ?? { x: program.start.x, y: program.start.y, heading: (program.start.headingDeg * Math.PI) / 180 };
  const speed = useMemo(() => {
    if (atStart || estimate.durationMs === 0) return 0;
    const before = estimate.poseAt(Math.max(0, elapsed - 25));
    const after = estimate.poseAt(Math.min(estimate.durationMs, elapsed + 25));
    return Math.hypot(after.x - before.x, after.y - before.y) / 0.05;
  }, [atStart, elapsed, estimate]);
  const markers = program.routine.flatMap((step) => {
    if (step.kind !== "path") return [];
    const entry = estimate.entries.find((item) => item.stepId === step.id);
    const index = program.paths.findIndex((item) => item.id === step.pathId);
    const path = program.paths[index];
    return entry && path ? [{ ms: entry.endMs, color: path.color, name: `Jump to the end of ${path.name || `Path ${index + 1}`}` }] : [];
  });
  const distance = paths.reduce((sum, path) => sum + path.curve.length, 0);

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
  const exportFile = () => {
    const result = exportVisualizer(program, { robot: project.robot });
    download(`${program.name.trim().replace(/[<>:"/\\|?*]/g, "-") || "program"}.pp`, result.text);
    if (result.warnings.length) onNotice(result.warnings.join("\n"));
  };
  const copyPoses = () => {
    const pose = (x: number, y: number, radians: number) => `new Pose(${number(x)}, ${number(y)}, Math.toRadians(${number((((radians * 180) / Math.PI) % 360 + 360) % 360)}))`;
    const lines = [
      `${pose(program.start.x, program.start.y, (program.start.headingDeg * Math.PI) / 180)} // start`,
      ...paths.map((path, index) => { const end = path.poseAt(1); return `${pose(end.x, end.y, end.heading)} // end of ${path.doc.name || `Path ${index + 1}`}`; }),
    ].join("\n");
    navigator.clipboard?.writeText(lines).then(() => onNotice("Copied the start and end poses as Pedro Pose code."), () => onNotice(lines));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (/INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const path = program.paths.find((item) => item.id === selection.pathId);
    if (key === "escape") { setTool("select"); setSelection({}); }
    else if (key === "p") setTool("pen");
    else if (key === "c") setTool("coordinate");
    else if (key === "w") addFromTool();
    else if (key === "g") cycleGrid();
    else if (key === "r") setRuler(!ruler);
    else if (key === "a" && path?.kind === "atomic") commit(insertControlPoint(program, path.id), { pathId: path.id });
    else if (key === " " && target.tagName !== "BUTTON") play();
    else if ((key === "delete" || key === "backspace") && path) {
      if (selection.point?.kind === "control") commit(removeControlPoint(program, path.id, selection.point.index), { pathId: path.id });
      else commit(deletePath(program, path.id), {});
    } else return;
    event.preventDefault();
  };

  return <div className="pathing" tabIndex={-1} onKeyDown={onKeyDown}>
    <header className="pv-topbar">
      <div className="pv-brand">
        <span className="pv-mark" aria-hidden="true"><Flame/></span>
        <div className="pv-title"><h1>{BRAND.name} Pathing Visualizer</h1><small>Based on the Pedro Pathing Visualizer</small></div>
      </div>
      <Menu label="File" items={[
        { label: "Import a .pp file…", run: () => fileInput.current?.click() },
        "separator",
        { label: "Mirror to the other alliance", run: () => commit(mirrorProgram(program)) },
        { label: "Mirrored copy as a new program", run: () => onAddProgram({ ...mirrorProgram(program), id: newId("auto"), name: `${program.name} (mirrored)` }) },
      ]}/>
      <span className="pv-program" title="The autonomous program you are editing. Rename it in the sidebar.">{program.name || "Unnamed program"}</span>
      <div className="pv-topbar-actions">
        <Menu label="Export" icon={<Download/>} align="end" items={[
          { label: "Pedro Pathing file (.pp)", run: exportFile },
          { label: "Copy poses as Pedro code", run: copyPoses },
        ]}/>
        <button type="button" className="pv-icon" aria-label="Start, field and robot" title="Start, field and robot"
          onClick={() => { setSelection({}); setRightHidden(false); }}><Settings/></button>
        <span className="pv-topbar-divider" aria-hidden="true"/>
        <button type="button" className="primary pv-preview" onClick={onPreview}><Play/>Preview<span className="pv-narrow-sr"> program</span></button>
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
        ? <button type="button" className="pv-restore" aria-label="Show layers" title="Show layers" onClick={() => setLeftHidden(false)}><PanelLeft/></button>
        : <LayersPanel project={project} program={program} estimate={estimate} selectedPathId={selection.pathId} overlayIds={overlayIds}
          robotPose={shownPose} speed={speed}
          onSelectPath={(pathId) => setSelection({ pathId })} onAddPath={addFromTool}
          onMovePath={(pathId, by) => commit(movePath(program, pathId, by))}
          onToggleOverlay={(id) => setOverlayIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id].slice(-4)))}
          onHide={() => setLeftHidden(true)}/>}
      <section className="pv-panel pv-field-panel" aria-label="Field">
        <FieldView project={project} program={program} paths={paths} overlays={overlays} selection={selection} tool={tool}
          grid={grid} snap={snap} ruler={ruler} protractor={protractor} protractorLocked={protractorLocked}
          fieldImage={fieldImage} robotPose={robotPose}
          onTool={setTool} onCycleGrid={cycleGrid} onSnap={toggleSnap} onRuler={() => setRuler(!ruler)} onProtractor={() => setProtractor(!protractor)}
          onProtractorLock={() => setProtractorLocked(!protractorLocked)} onSelect={setSelection} onCommit={commit} onAddPath={addFromTool} onNotice={onNotice}/>
        <PlaybackBar elapsed={elapsed} duration={estimate.durationMs} playing={playing} loop={loop} markers={markers} distance={distance}
          overBy={estimate.durationMs - AUTONOMOUS_PERIOD_MS} onPlay={play} onLoop={() => setLoop(!loop)} onSeek={seek}/>
        {estimate.error && <p className="pv-error" role="alert">{estimate.error}</p>}
      </section>
      {rightHidden
        ? <button type="button" className="pv-restore" aria-label="Show inspector" title="Show inspector" onClick={() => setRightHidden(false)}><PanelRight/></button>
        : <Inspector project={project} program={program} selection={selection} profiles={estimate.profiles} fieldId={fieldId} customImage={customImage}
          onField={setField} onCustomImage={() => imageInput.current?.click()} onCommit={commit} onSelect={setSelection} onOpenRobot={onOpenRobot}
          onHide={() => setRightHidden(true)}/>}
    </div>
  </div>;
}
