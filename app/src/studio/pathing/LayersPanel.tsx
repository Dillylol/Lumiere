import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, PanelLeft, Plus } from "lucide-react";
import { AUTONOMOUS_PERIOD_MS, describeDeviceStep, describeStateStep, seconds, type AutonomousProgram, type Pose, type Project, type RoutineEstimate, type Step } from "../../core";

/** A collapsible group in a panel, with a count and actions in its header. */
export function Section({ title, count, actions, open: initial = true, children }: { title: string; count?: number; actions?: ReactNode; open?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initial);
  return <section className="pv-section">
    <div className="pv-section-head">
      <button type="button" className="pv-section-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronDown className={open ? undefined : "collapsed"} aria-hidden="true"/>
        <span>{title}</span>
        {count !== undefined && <span className="pv-count">{count}</span>}
      </button>
      {actions}
    </div>
    {open && <div className="pv-section-body">{children}</div>}
  </section>;
}

function stepLabel(step: Step, program: AutonomousProgram, project: Project): string {
  switch (step.kind) {
    case "path": return program.paths.find((path) => path.id === step.pathId)?.name || "Path";
    case "wait": return "Wait";
    case "state": return describeStateStep(project, step);
    case "device": return describeDeviceStep(step);
    case "together": return `Together (${step.steps.length})`;
    case "race": return `Race (${step.steps.length})`;
  }
}

/** The routine's steps in order with their estimated times against the 30-second budget; `activeIds` marks the steps running now. */
export function RoutineSteps({ project, program, estimate, activeIds, onSelectPath }: {
  project: Project; program: AutonomousProgram; estimate: RoutineEstimate; activeIds?: string[]; onSelectPath?(pathId: string): void;
}) {
  return <>
    {program.routine.length ? <ol className="pv-routine">
      {program.routine.map((step) => {
        const entry = estimate.entries.find((item) => item.stepId === step.id);
        const path = step.kind === "path" ? program.paths.find((item) => item.id === step.pathId) : undefined;
        const label = stepLabel(step, program, project);
        const active = !!activeIds?.includes(step.id);
        return <li key={step.id} className={`pv-step ${step.kind}${active ? " active" : ""}`} aria-current={active ? "step" : undefined}>
          <i className="pv-dot" style={{ background: path?.color ?? (step.kind === "wait" ? "transparent" : "var(--mint)") }} aria-hidden="true"/>
          {path && onSelectPath ? <button type="button" className="pv-row-name" onClick={() => onSelectPath(path.id)}>{label}</button> : <span className="pv-row-name static">{label}</span>}
          <small>{entry ? seconds(entry.endMs - entry.startMs) : "—"}</small>
        </li>;
      })}
    </ol> : <p className="pv-empty">Paths you add are driven in order. Add mechanisms and waits in Build.</p>}
    <p className={estimate.durationMs > AUTONOMOUS_PERIOD_MS ? "pv-total over" : "pv-total"}>
      Total {seconds(estimate.durationMs)}{estimate.durationMs > AUTONOMOUS_PERIOD_MS ? ` · ${seconds(estimate.durationMs - AUTONOMOUS_PERIOD_MS)} over 30 s` : " of 30 s"}
    </p>
  </>;
}

export interface LayersPanelProps {
  project: Project;
  program: AutonomousProgram;
  estimate: RoutineEstimate;
  selectedPathId?: string;
  overlayIds: string[];
  robotPose: Pose;
  speed: number;
  /** Routine steps running at playback's time. */
  activeIds?: string[];
  /** The state the plan has each mechanism in at playback's time, by mechanism id. */
  planned?: Record<string, string>;
  onSelectPath(pathId: string): void;
  onAddPath(): void;
  onMovePath(pathId: string, by: number): void;
  onToggleOverlay(programId: string): void;
  onHide(): void;
}

/** Paths, overlays of other programs, the robot's pose and the routine: the Visualizer's Layers panel. */
export function LayersPanel({ project, program, estimate, selectedPathId, overlayIds, robotPose, speed, activeIds, planned, onSelectPath, onAddPath, onMovePath, onToggleOverlay, onHide }: LayersPanelProps) {
  const others = project.programs.filter((item): item is AutonomousProgram => item.kind === "autonomous" && item.id !== program.id);
  const readouts = [
    { label: "X", value: robotPose.x.toFixed(1), unit: "in" },
    { label: "Y", value: robotPose.y.toFixed(1), unit: "in" },
    { label: "Heading", value: ((robotPose.heading * 180) / Math.PI).toFixed(0), unit: "°" },
    { label: "Speed", value: speed.toFixed(0), unit: "in/s" },
  ];
  return <aside className="pv-panel pv-layers" aria-label="Layers">
    <div className="pv-panel-head">
      <h2>Layers</h2>
      <button type="button" className="pv-icon small" aria-label="Hide layers" title="Hide layers" onClick={onHide}><PanelLeft/></button>
    </div>
    <div className="pv-panel-scroll">
      <Section title="Paths" count={program.paths.length} actions={<button type="button" className="pv-icon small" aria-label="Add path" title="Add path (W)" onClick={onAddPath}><Plus/></button>}>
        {program.paths.length ? <div role="tree" aria-label="Paths">
          {program.paths.map((path, index) => {
            const selected = path.id === selectedPathId;
            const name = path.name || `Path ${index + 1}`;
            const profile = estimate.profiles.get(path.id);
            return <div key={path.id} role="treeitem" aria-selected={selected} className={selected ? "pv-row selected" : "pv-row"}>
              <i className="pv-dot" style={{ background: path.color }} aria-hidden="true"/>
              <button type="button" className="pv-row-name" onClick={() => onSelectPath(path.id)}>{name}</button>
              {selected ? <>
                <button type="button" className="pv-icon tiny" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => onMovePath(path.id, -1)}><ArrowUp/></button>
                <button type="button" className="pv-icon tiny" aria-label={`Move ${name} down`} disabled={index === program.paths.length - 1} onClick={() => onMovePath(path.id, 1)}><ArrowDown/></button>
              </> : <small>{profile ? seconds(profile.durationMs) : "—"}</small>}
            </div>;
          })}
        </div> : <p className="pv-empty">Double-click the field, draw with the pen, or press + to add a path.</p>}
      </Section>

      <Section title="Overlays" count={overlayIds.length || undefined} open={false}>
        {others.length ? others.map((other) => {
          const on = overlayIds.includes(other.id);
          return <div key={other.id} className="pv-row">
            <button type="button" className={on ? "pv-icon tiny active" : "pv-icon tiny"} aria-pressed={on} aria-label={`${on ? "Hide" : "Show"} ${other.name} on the field`} onClick={() => onToggleOverlay(other.id)}>{on ? <Eye/> : <EyeOff/>}</button>
            <i className="pv-dot" style={{ background: other.paths[0]?.color ?? "var(--muted)" }} aria-hidden="true"/>
            <span className="pv-row-name static">{other.name}</span>
          </div>;
        }) : <p className="pv-empty">Your other autonomous programs can show here, faded under the paths you edit.</p>}
      </Section>

      <Section title="Robot">
        <dl className="pv-readouts" aria-label="Robot pose">
          {readouts.map(({ label, value, unit }) => <div key={label}><dt>{label}</dt><dd>{value}<span>{unit}</span></dd></div>)}
        </dl>
        {planned && project.subsystems.length > 0 && <dl className="pv-pairs" aria-label="Planned mechanism states">
          {project.subsystems.map((subsystem) => <div key={subsystem.id}>
            <dt>{subsystem.name}</dt>
            <dd>{subsystem.states.find((state) => state.id === planned[subsystem.id])?.name ?? "Not set yet"}</dd>
          </div>)}
        </dl>}
      </Section>

      <Section title="Routine" count={program.routine.length}>
        <RoutineSteps project={project} program={program} estimate={estimate} activeIds={activeIds} onSelectPath={onSelectPath}/>
      </Section>
    </div>
  </aside>;
}
