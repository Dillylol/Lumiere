import { BRAND } from "../brand";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, BookOpen, Bot, CheckCircle2, ChevronDown, CircleAlert, CircleStop, Code2, Command, Cpu, Download, Gauge, GraduationCap, HelpCircle, Menu, PanelRightClose, PanelRightOpen, Play, Plug, Radio, Route, Save, Settings, Upload, Waypoints, Wrench, X } from "lucide-react";
import { GuidedBuilder } from "./GuidedBuilder";
import { PathEditor } from "./PathEditor";
import { Modal } from "./ui/Modal";
import { generateJules, parseJules } from "../language/julesLanguage";
import { createProgram, STARTER_SOURCES, type Diagnostic, type ExperienceMode, type JulesProjectV1, type ProgramDocument, type ProgramIR, type SaveState } from "../models/project";
import { loadPedroPathFromBrowserFile } from "../utils/ppInterpreter";


type WorkspaceTool = JulesProjectV1["workspace"]["activeTool"];

interface WorkspaceShellProps {
  project: JulesProjectV1;
  saveState: SaveState;
  onBack: () => void;
  onUpdate: (project: JulesProjectV1) => void;
  onExport: () => void;
}

const tools: Array<{ id: WorkspaceTool; label: string; icon: typeof Code2; description: string }> = [
  { id: "build", label: "Build", icon: Code2, description: `Visual workflow and ${BRAND.name} IDE` },
  { id: "paths", label: "Paths", icon: Waypoints, description: "Pedro path planning" },
  { id: "simulate", label: "Simulate", icon: Play, description: "Program preview" },
  { id: "robot", label: "Robot", icon: Bot, description: "Hardware and telemetry" },
  { id: "learn", label: "Learn", icon: GraduationCap, description: "Contextual project guidance" },
];

const loadAdvancedIde = () => import("./AdvancedIde").then((module) => ({ default: module.AdvancedIde }));
const AdvancedIde = lazy(loadAdvancedIde);
const SimulatorTab = lazy(() => import("./SimulatorTab").then((module) => ({ default: module.SimulatorTab })));

export function WorkspaceShell({ project, saveState, onBack, onUpdate, onExport }: WorkspaceShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [announce, setAnnounce] = useState("");
  const [output, setOutput] = useState<string[]>(["Project opened. Simulator is the default run target."]);
  const ppInputRef = useRef<HTMLInputElement>(null);
  const [stopRevision, setStopRevision] = useState(0);
  const activeProgram = project.programs.find((program) => program.id === project.activeProgramId) ?? project.programs[0];
  const parsed = useMemo(() => parseJules(activeProgram.draftSource), [activeProgram.draftSource]);
  const diagnostics = parsed.diagnostics;
  const errors = diagnostics.filter((item) => item.severity === "error");

  const update = (patch: Partial<JulesProjectV1>) => onUpdate({ ...project, ...patch, updatedAt: new Date().toISOString() });
  const updateWorkspace = (patch: Partial<JulesProjectV1["workspace"]>) => {
    const completed = patch.activeTool === "simulate" && !project.guidance.completed.includes("preview-simulation")
      ? [...project.guidance.completed, "preview-simulation"]
      : project.guidance.completed;
    update({ workspace: { ...project.workspace, ...patch }, guidance: { ...project.guidance, completed } });
  };
  const updateProgram = (program: ProgramDocument) => update({ programs: project.programs.map((item) => item.id === program.id ? program : item) });

  const setMode = (mode: ExperienceMode) => {
    update({ experienceMode: mode });
    localStorage.setItem("jules-experience-mode", mode);
    setAnnounce(`${mode === "beginner" ? "Beginner" : "Advanced"} mode enabled`);
  };

  const setSource = (draftSource: string) => {
    const result = parseJules(draftSource);
    updateProgram({
      ...activeProgram,
      draftSource,
      ...(result.diagnostics.some((item) => item.severity === "error") ? {} : { source: draftSource, ir: result.ir, sourceRevision: result.sourceRevision }),
      updatedAt: new Date().toISOString(),
    });
  };

  const setIr = (ir: ProgramIR) => {
    const source = generateJules(ir);
    updateProgram({ ...activeProgram, ir, source, draftSource: source, sourceRevision: parseJules(source).sourceRevision, updatedAt: new Date().toISOString() });
  };

  const addProgram = () => {
    const kind = project.programs.some((program) => program.kind === "teleop") ? "autonomous" : "teleop";
    const parsedStarter = parseJules(STARTER_SOURCES[kind]);
    const program = createProgram(kind, kind === "teleop" ? "Main TeleOp" : "New Auto", STARTER_SOURCES[kind], parsedStarter.ir);
    update({ programs: [...project.programs, program], activeProgramId: program.id });
  };

  const run = () => {
    if (errors.length) {
      updateWorkspace({ bottomPanel: "problems" });
      setAnnounce(`Run blocked by ${errors.length} program ${errors.length === 1 ? "error" : "errors"}`);
      return;
    }
    if (project.workspace.runTarget === "simulator") {
      updateWorkspace({ activeTool: "simulate" });
      setOutput((items) => [...items.slice(-49), `Opened simulation preview for ${activeProgram.name}.`]);
      setAnnounce("Simulator opened");
      return;
    }
    updateWorkspace({ activeTool: "robot" });
    setAnnounce("Robot connection is planned. Start real OpModes from the Driver Station.");
  };

  const stop = () => {
    setStopRevision((revision) => revision + 1);
    setOutput((items) => [...items.slice(-49), "Preview stopped. Stop real robots from the Driver Station."]);
    setAnnounce("Stop requested");
  };

  const importPedro = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const { dsl, baseName } = await loadPedroPathFromBrowserFile(file);
      const result = parseJules(dsl);
      const program = createProgram("autonomous", `${baseName} path`, dsl, result.ir);
      update({ programs: [...project.programs, program], activeProgramId: program.id, workspace: { ...project.workspace, activeTool: "build" } });
      setOutput((items) => [...items.slice(-49), `Imported Pedro path ${file.name}.`]);
    } catch (error) {
      setOutput((items) => [...items.slice(-49), `Could not import ${file.name}: ${error instanceof Error ? error.message : String(error)}`]);
      updateWorkspace({ bottomPanel: "output" });
    }
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setAnnounce(saveState === "saved" ? "Project already saved" : "Autosave is active");
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        run();
      }
      if (event.shiftKey && event.key === "F5") {
        event.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  useEffect(() => {
    if (project.experienceMode === "advanced") return;
    const timer = window.setTimeout(() => { void loadAdvancedIde(); }, 1_200);
    return () => window.clearTimeout(timer);
  }, [project.experienceMode]);

  const commands = [
    ...tools.map((tool) => ({ label: `Open ${tool.label}`, keywords: tool.description, action: () => updateWorkspace({ activeTool: tool.id }) })),
    { label: project.experienceMode === "beginner" ? "Switch to Advanced mode" : "Switch to Beginner mode", keywords: "editor visual experience", action: () => setMode(project.experienceMode === "beginner" ? "advanced" : "beginner") },
    { label: "Run in simulator", keywords: "start play", action: () => { updateWorkspace({ runTarget: "simulator" }); run(); } },
    { label: "Export project", keywords: "save download file", action: onExport },
  ].filter((command) => `${command.label} ${command.keywords}`.toLowerCase().includes(paletteQuery.toLowerCase()));

  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-main">Skip to workspace</a>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announce}</div>
      <header className="workspace-topbar">
        <div className="workspace-topbar__start">
          <button className="icon-button" type="button" onClick={onBack} aria-label="Back to projects"><ArrowLeft /></button>
          <span className="brand-mark brand-mark--compact" aria-hidden="true"><Bot /></span>
          <div className="project-title"><strong>{project.name}</strong><span className={`save-indicator save-indicator--${saveState}`}><Save />{saveState === "saved" ? "Saved" : saveState}</span></div>
        </div>
        <div className="workspace-topbar__center">
          <label className="compact-select"><span className="sr-only">Experience mode</span><select value={project.experienceMode} onChange={(event) => setMode(event.target.value as ExperienceMode)}><option value="beginner">Beginner</option><option value="advanced">Advanced</option></select><ChevronDown aria-hidden="true" /></label>
          <label className="compact-select run-target"><span className="sr-only">Run target</span><select value={project.workspace.runTarget} onChange={(event) => updateWorkspace({ runTarget: event.target.value as "simulator" | "robot" })}><option value="simulator">Simulator</option><option value="robot">Robot</option></select><ChevronDown aria-hidden="true" /></label>
          <button className="button button--run" type="button" onClick={run} disabled={errors.length > 0} title={errors.length ? "Fix program errors before running" : `Run using ${project.workspace.runTarget}`}><Play /> Run</button>
          <button className="icon-button icon-button--stop" type="button" onClick={stop} aria-label="Stop program"><CircleStop /></button>
        </div>
        <div className="workspace-topbar__end">
          <button className="command-trigger" type="button" aria-label="Open command palette" onClick={() => setPaletteOpen(true)}><Command aria-hidden="true" /><span>Commands</span><kbd aria-hidden="true">Ctrl K</kbd></button>
          <a className="icon-button" href="#/help" aria-label="Open help"><HelpCircle /></a>
          <a className="icon-button" href="#/settings" aria-label="Open settings"><Settings /></a>
          <button className="icon-button mobile-only" type="button" aria-label="Open workspace navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(!mobileNavOpen)}>{mobileNavOpen ? <X /> : <Menu />}</button>
        </div>
      </header>

      <nav className={`activity-rail ${mobileNavOpen ? "activity-rail--open" : ""}`} aria-label="Workspace tools">
        {tools.map((tool) => { const Icon = tool.icon; return <button key={tool.id} type="button" className={project.workspace.activeTool === tool.id ? "active" : ""} aria-current={project.workspace.activeTool === tool.id ? "page" : undefined} onClick={() => { updateWorkspace({ activeTool: tool.id }); setMobileNavOpen(false); }}><Icon /><span>{tool.label}</span></button>; })}
        <div className="activity-rail__status"><span className="connection-dot connection-dot--disconnected" /><span>Offline workspace</span></div>
      </nav>

      <aside className="program-sidebar" aria-label="Project programs">
        <div className="program-sidebar__header"><div><p className="eyebrow">Project</p><h2>Programs</h2></div><button className="icon-button" type="button" aria-label="Add program" onClick={addProgram}>+</button></div>
        <div className="program-list">
          {project.programs.map((program) => <button key={program.id} type="button" className={program.id === activeProgram.id ? "active" : ""} onClick={() => update({ activeProgramId: program.id })}><span className="program-kind">{program.kind === "teleop" ? <Activity /> : program.kind === "utility" ? <Wrench /> : <Route />}</span><span><strong>{program.name}</strong><small>{program.kind}</small></span></button>)}
        </div>
        <div className="program-sidebar__footer"><button className="button button--ghost" onClick={onExport}><Download /> Export .{BRAND.projectExtension}</button></div>
      </aside>

      <main id="workspace-main" className="workspace-main">
        {project.workspace.activeTool === "build" && (project.experienceMode === "beginner" ? <GuidedBuilder ir={activeProgram.ir} manifest={project.robotManifest} inspectorOpen={project.workspace.inspectorOpen} onChange={setIr} /> : <Suspense fallback={<WorkspaceLoading label={`Loading the ${BRAND.name} IDE`} />}><AdvancedIde program={activeProgram} diagnostics={diagnostics} manifest={project.robotManifest} onSourceChange={setSource} /></Suspense>)}
        {project.workspace.activeTool === "paths" && <PathsView ir={activeProgram.ir} onChange={setIr} onImport={() => ppInputRef.current?.click()} />}
        {project.workspace.activeTool === "simulate" && <div className="simulator-surface"><div className="surface-banner"><div><p className="eyebrow">Kinematic preview</p><h2>{activeProgram.name}</h2></div><span className="badge badge--warning">Physics engine planned</span></div><Suspense fallback={<WorkspaceLoading label="Loading simulation preview" />}><SimulatorTab key={activeProgram.id} code={activeProgram.draftSource} visible stopRevision={stopRevision} /></Suspense></div>}
        {project.workspace.activeTool === "robot" && <RobotView project={project} onManifest={(manifest) => update({ robotManifest: manifest })} />}
        {project.workspace.activeTool === "learn" && <LearnView project={project} diagnostics={diagnostics} onOpenBuild={() => updateWorkspace({ activeTool: "build" })} onOpenSimulate={() => updateWorkspace({ activeTool: "simulate" })} />}
        <input ref={ppInputRef} className="sr-only" tabIndex={-1} type="file" accept=".pp,application/json" aria-label="Import Pedro path file" onChange={importPedro} />
      </main>

      <section className="bottom-panel" aria-label="Workspace messages">
        <div className="bottom-panel__tabs" role="tablist" aria-label="Message panels">
          {(["problems", "output", "telemetry"] as const).map((panel) => <button key={panel} role="tab" aria-selected={project.workspace.bottomPanel === panel} onClick={() => updateWorkspace({ bottomPanel: panel })}>{panel === "problems" && diagnostics.length > 0 && <span className="count-badge">{diagnostics.length}</span>}{panel}</button>)}
        </div>
        <div className="bottom-panel__content">
          {project.workspace.bottomPanel === "problems" && <Problems diagnostics={diagnostics} />}
          {project.workspace.bottomPanel === "output" && <div className="output-lines">{output.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}</div>}
          {project.workspace.bottomPanel === "telemetry" && <div className="panel-message"><Radio /><span>Robot telemetry is planned. The preview does not run FTC Java.</span></div>}
        </div>
      </section>

      <button className="inspector-toggle" type="button" onClick={() => updateWorkspace({ inspectorOpen: !project.workspace.inspectorOpen })} aria-label={project.workspace.inspectorOpen ? "Close inspector" : "Open inspector"}>{project.workspace.inspectorOpen ? <PanelRightClose /> : <PanelRightOpen />}</button>

      <Modal open={paletteOpen} title="Command palette" description="Search workspace actions. Press Escape to close." onClose={() => { setPaletteOpen(false); setPaletteQuery(""); }}>
        <label className="command-search"><span className="sr-only">Search commands</span><Command /><input value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Type a command…" /></label>
        <div className="command-list" role="listbox" aria-label="Available commands">{commands.map((command) => <button role="option" aria-selected="false" key={command.label} onClick={() => { command.action(); setPaletteOpen(false); setPaletteQuery(""); }}>{command.label}</button>)}</div>
      </Modal>
    </div>
  );
}

function Problems({ diagnostics }: { diagnostics: Diagnostic[] }) {
  if (!diagnostics.length) return <div className="panel-message panel-message--success"><CheckCircle2 /><span>No problems found. This program can be represented in both visual and code views.</span></div>;
  return <ul className="problem-list">{diagnostics.map((item) => <li key={item.id}><CircleAlert /><button type="button"><strong>Line {item.line}</strong> {item.message}{item.suggestion && <small>{item.suggestion}</small>}</button></li>)}</ul>;
}

function WorkspaceLoading({ label }: { label: string }) { return <div className="workspace-loading" role="status"><span className="loading-bar" aria-hidden="true" /><span>{label}…</span></div>; }

function PathsView({ ir, onChange, onImport }: { ir: ProgramIR; onChange: (ir: ProgramIR) => void; onImport: () => void }) {
  return <section className="feature-surface path-surface"><header className="workspace-section-header"><div><p className="eyebrow">Field planning</p><h2>Pedro paths</h2><p>Create and edit field waypoints directly, or import an existing `.pp` file into the active project.</p></div><button className="button button--secondary" onClick={onImport}><Upload /> Import .pp</button></header><PathEditor ir={ir} onChange={onChange} /></section>;
}

function RobotView({ project, onManifest }: { project: JulesProjectV1; onManifest: (manifest: Record<string, unknown>) => void }) {
  const [text, setText] = useState(JSON.stringify(project.robotManifest, null, 2));
  const [error, setError] = useState("");
  const apply = () => { try { const value = JSON.parse(text); if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(); onManifest(value); setError(""); } catch { setError("Manifest must be valid JSON before it can be applied."); } };
  return <section className="feature-surface"><header className="workspace-section-header"><div><p className="eyebrow">Robot workspace</p><h2>Hardware and connection</h2></div><button className="button button--secondary" disabled><Plug />Connection planned</button></header><div className="robot-overview"><div className="robot-status-card"><span className="connection-dot connection-dot--disconnected" /><div><strong>No robot connected</strong><small>Start and stop real OpModes from the Driver Station.</small></div></div><Metric label="Battery" value="—" icon={Gauge} /><Metric label="Latency" value="—" icon={Activity} /><Metric label="OpMode" value="—" icon={Cpu} /></div><div className="manifest-editor"><div><h3>Robot capability manifest</h3><p>Hardware names feed completion, visual actions, validation, and later simulation.</p>{error && <p className="field-error" role="alert">{error}</p>}<button className="button button--secondary" onClick={apply}>Apply manifest</button></div><label><span className="sr-only">Robot capability manifest JSON</span><textarea value={text} spellCheck={false} onChange={(event) => setText(event.target.value)} /></label></div></section>;
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Gauge }) { return <div className="metric-card"><Icon /><span><small>{label}</small><strong>{value}</strong></span></div>; }

function LearnView({ project, diagnostics, onOpenBuild, onOpenSimulate }: { project: JulesProjectV1; diagnostics: Diagnostic[]; onOpenBuild: () => void; onOpenSimulate: () => void }) {
  const active = project.programs.find((item) => item.id === project.activeProgramId) ?? project.programs[0];
  const steps = [
    { title: "Create a program", detail: `You are building ${active.kind === "teleop" ? "a TeleOp" : active.kind === "autonomous" ? "an autonomous" : "a utility"} program.`, done: Boolean(active), action: onOpenBuild },
    { title: "Add a safe action", detail: "Start with conservative power and a clear duration.", done: active.ir.actions.length > 0, action: onOpenBuild },
    { title: "Resolve every problem", detail: diagnostics.length ? `${diagnostics.length} issue${diagnostics.length === 1 ? "" : "s"} currently need attention.` : `The current ${BRAND.name} source is valid.`, done: diagnostics.length === 0, action: onOpenBuild },
    { title: "Declare a stop", detail: "Every program needs predictable actuator behavior at the end.", done: active.ir.actions.some((action) => action.kind === "stop"), action: onOpenBuild },
    { title: "Preview in simulation", detail: "Check sequencing and field motion before connecting hardware.", done: project.guidance.completed.includes("preview-simulation"), action: onOpenSimulate },
  ];
  const next = steps.find((step) => !step.done);
  const concepts = [...new Set(active.ir.actions.map((action) => action.kind))].map((kind) => conceptFor(kind));
  return <section className="feature-surface learn-surface"><header className="workspace-section-header"><div><p className="eyebrow">Contextual learning</p><h2>Learn from {active.name}</h2><p>Guidance is derived from the program in front of you, so each lesson has an immediate place to apply it.</p></div><span className="progress-ring" aria-label={`${steps.filter((step) => step.done).length} of ${steps.length} complete`}>{steps.filter((step) => step.done).length}/{steps.length}</span></header>{next ? <aside className="next-lesson"><div><p className="eyebrow">Recommended next</p><h3>{next.title}</h3><p>{next.detail}</p></div><button className="button button--primary" type="button" onClick={next.action}>Work on this</button></aside> : <aside className="next-lesson next-lesson--complete"><CheckCircle2 /><div><h3>Core project checks complete</h3><p>Keep iterating in simulation and explain each action to a teammate before moving to hardware.</p></div></aside>}<div className="learning-layout"><ol className="learning-steps">{steps.map((step, index) => <li key={step.title} className={step.done ? "complete" : !next?.done && step.title === next?.title ? "current" : ""}><span>{step.done ? <CheckCircle2 /> : index + 1}</span><div><strong>{step.title}</strong><p>{step.detail}</p></div><button type="button" onClick={step.action}>{step.done ? "Review" : "Open"}</button></li>)}</ol><section className="concept-library" aria-labelledby="concepts-heading"><div><p className="eyebrow">In this program</p><h3 id="concepts-heading">Concepts to explain</h3></div>{concepts.length ? concepts.map((concept) => <article key={concept.title}><strong>{concept.title}</strong><p>{concept.detail}</p><code>{concept.example}</code></article>) : <div className="panel-message"><BookOpen /><span>Add an action to unlock a relevant concept lesson.</span></div>}</section></div><aside className="concept-card"><BookOpen /><div><p className="eyebrow">Teaching method</p><h3>Predict, run, explain</h3><p>Before simulation, predict the robot pose after each action. Run the preview, compare the result, then explain the {BRAND.name} statement and generated Java to a teammate.</p></div></aside></section>;
}

function conceptFor(kind: ProgramIR["actions"][number]["kind"]) {
  const lessons: Record<typeof kind, { title: string; detail: string; example: string }> = {
    drive: { title: "Robot-relative movement", detail: "Forward and strafe directions rotate with the robot heading. Power affects speed; duration affects distance.", example: "drive.forward(0.45, 1000)" },
    turn: { title: "Heading", detail: "Turning changes the coordinate frame used by every movement that follows it.", example: "turn.right(0.3, 500)" },
    wait: { title: "Sequencing", detail: "A wait pauses the sequence; it does not hold a mechanism safely unless its prior command does so.", example: "wait(250)" },
    motor: { title: "Motor power", detail: "FTC motor power ranges from -1 to 1. Start low and confirm direction before increasing it.", example: "motor.set(\"frontLeft\", 0.25)" },
    servo: { title: "Servo position", detail: "Servo targets range from 0 to 1, but the mechanically safe range may be smaller.", example: "servo.set(\"claw\", 0.5)" },
    stop: { title: "Safe final state", detail: "A declared stop makes the intended end behavior visible to reviewers and future teammates.", example: "stop()" },
    path: { title: "Field coordinates", detail: "Waypoints use the 144-inch FTC field. Heading describes the robot orientation at a point.", example: "path.linear(72, 120, 0)" },
    custom: { title: "Unrecognized intent", detail: "Custom source should be reviewed carefully because the guided builder cannot explain or validate it yet.", example: "# Review custom behavior" },
  };
  return lessons[kind];
}
