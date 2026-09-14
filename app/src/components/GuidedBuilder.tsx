import { BRAND } from "../brand";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CircleStop, Cog, Copy, Gauge, GripVertical, Lightbulb, Plus, RotateCw, SlidersHorizontal, Timer, Trash2, Waypoints, Zap } from "lucide-react";
import { actionToSource } from "../language/julesLanguage";
import type { ProgramAction, ProgramIR } from "../models/project";
import { Modal } from "./ui/Modal";

interface GuidedBuilderProps {
  ir: ProgramIR;
  manifest: Record<string, unknown>;
  inspectorOpen: boolean;
  onChange: (ir: ProgramIR) => void;
}

const actionCatalog = [
  { kind: "drive" as const, label: "Drive", description: "Move forward, backward, or strafe for a controlled time.", icon: Gauge },
  { kind: "turn" as const, label: "Turn", description: "Rotate left or right at a safe power.", icon: RotateCw },
  { kind: "wait" as const, label: "Wait", description: "Pause before the next action begins.", icon: Timer },
  { kind: "motor" as const, label: "Set motor", description: "Set one configured motor's power.", icon: Cog },
  { kind: "servo" as const, label: "Set servo", description: "Move one configured servo to a position.", icon: SlidersHorizontal },
  { kind: "path" as const, label: "Pedro path", description: "Follow a path segment created in Paths.", icon: Waypoints },
  { kind: "stop" as const, label: "Stop", description: "Put every actuator into its safe stopped state.", icon: CircleStop },
];

export function GuidedBuilder({ ir, manifest, inspectorOpen, onChange }: GuidedBuilderProps) {
  const [selectedId, setSelectedId] = useState(ir.actions[0]?.id);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const selected = ir.actions.find((action) => action.id === selectedId) ?? ir.actions[0];
  const motors = useMemo(() => listDevices(manifest, "motors", ["frontLeft", "frontRight", "backLeft", "backRight"]), [manifest]);
  const servos = useMemo(() => listDevices(manifest, "servos", ["claw"]), [manifest]);

  const replace = (actions: ProgramAction[]) => onChange({ ...ir, actions });
  const update = (id: string, patch: Partial<ProgramAction>) => replace(ir.actions.map((action) => action.id === id ? { ...action, ...patch } : action));
  const remove = (id: string) => {
    const index = ir.actions.findIndex((action) => action.id === id);
    const actions = ir.actions.filter((action) => action.id !== id);
    replace(actions);
    setSelectedId(actions[Math.max(0, index - 1)]?.id);
  };
  const move = (id: string, delta: -1 | 1) => {
    const actions = [...ir.actions];
    const from = actions.findIndex((action) => action.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= actions.length) return;
    [actions[from], actions[to]] = [actions[to], actions[from]];
    replace(actions);
  };
  const duplicate = (action: ProgramAction) => {
    const index = ir.actions.findIndex((item) => item.id === action.id);
    const copy = { ...structuredClone(action), id: `action-${crypto.randomUUID()}`, leadingComments: [] };
    const actions = [...ir.actions];
    actions.splice(index + 1, 0, copy);
    replace(actions);
    setSelectedId(copy.id);
  };
  const add = (kind: ProgramAction["kind"]) => {
    const action = createAction(kind, motors[0], servos[0]);
    replace([...ir.actions, action]);
    setSelectedId(action.id);
    setLibraryOpen(false);
  };

  return (
    <div className={`guided-layout ${inspectorOpen ? "guided-layout--inspector" : ""}`}>
      <section className="builder-canvas" aria-labelledby="program-flow-heading">
        <header className="workspace-section-header">
          <div><p className="eyebrow">Guided build</p><h2 id="program-flow-heading">Program flow</h2></div>
          <button className="button button--primary" type="button" onClick={() => setLibraryOpen(true)}><Plus /> Add action</button>
        </header>
        <div className="program-start"><span>INIT</span><strong>Prepare the robot safely</strong></div>
        <ol className="action-sequence" aria-label="Program actions">
          {ir.actions.map((action, index) => {
            const catalog = actionCatalog.find((item) => item.kind === action.kind);
            const Icon = catalog?.icon ?? Zap;
            return (
              <li key={action.id} className="action-row-wrap">
                <span className="sequence-line" aria-hidden="true" />
                <button
                  type="button"
                  className={`action-row ${action.id === selected?.id ? "action-row--selected" : ""} ${!action.enabled ? "action-row--disabled" : ""}`}
                  aria-current={action.id === selected?.id ? "step" : undefined}
                  onClick={() => setSelectedId(action.id)}
                >
                  <GripVertical className="action-row__grip" aria-hidden="true" />
                  <span className="action-row__index">{index + 1}</span>
                  <span className="action-row__icon"><Icon aria-hidden="true" /></span>
                  <span className="action-row__copy"><strong>{action.label}</strong><small>{summarize(action)}</small></span>
                  {!action.enabled && <span className="badge">Disabled</span>}
                </button>
                <div className="action-row__buttons" aria-label={`Reorder ${action.label}`}>
                  <button className="icon-button" type="button" disabled={index === 0} onClick={() => move(action.id, -1)} aria-label={`Move ${action.label} up`}><ArrowUp /></button>
                  <button className="icon-button" type="button" disabled={index === ir.actions.length - 1} onClick={() => move(action.id, 1)} aria-label={`Move ${action.label} down`}><ArrowDown /></button>
                </div>
              </li>
            );
          })}
        </ol>
        {!ir.actions.length && <div className="empty-state empty-state--compact"><Waypoints /><h3>Your program is empty</h3><p>Add the first action. {BRAND.name} will explain each choice as you build.</p><button className="button button--primary" onClick={() => setLibraryOpen(true)}><Plus /> Add first action</button></div>}
        <div className="program-stop"><span>STOP</span><strong>End in a declared safe state</strong></div>
      </section>

      {inspectorOpen && (
        <aside className="inspector" aria-labelledby="inspector-heading">
          {selected ? (
            <>
              <header className="inspector__header"><p className="eyebrow">Selected action</p><h2 id="inspector-heading">{selected.label}</h2><code>{actionToSource(selected).split("\n").slice(-1)[0]}</code></header>
              <div className="inspector__body">
                <label className="toggle-row"><span><strong>Action enabled</strong><small>Disabled actions remain visible but do not run.</small></span><input type="checkbox" checked={selected.enabled} onChange={(event) => update(selected.id, { enabled: event.target.checked })} /></label>
                <ActionFields action={selected} motors={motors} servos={servos} onArgs={(args) => update(selected.id, { args, label: labelFor(selected.kind, args), source: actionToSource({ ...selected, args, leadingComments: [] }) })} />
                <div className="learning-callout"><Lightbulb aria-hidden="true" /><div><strong>Why this matters</strong><p>{explanationFor(selected.kind)}</p></div></div>
              </div>
              <footer className="inspector__footer"><button className="button button--ghost" onClick={() => duplicate(selected)}><Copy /> Duplicate</button><button className="button button--danger-quiet" onClick={() => remove(selected.id)}><Trash2 /> Delete</button></footer>
            </>
          ) : <div className="empty-state empty-state--compact"><h3>Select an action</h3><p>Its settings and explanation will appear here.</p></div>}
        </aside>
      )}

      <Modal open={libraryOpen} title="Add an action" description="Choose what the robot or program should do next." onClose={() => setLibraryOpen(false)}>
        <div className="action-library">
          {actionCatalog.map((item) => { const Icon = item.icon; return <button key={item.kind} type="button" onClick={() => add(item.kind)}><span><Icon /></span><strong>{item.label}</strong><small>{item.description}</small></button>; })}
        </div>
      </Modal>
    </div>
  );
}

function ActionFields({ action, motors, servos, onArgs }: { action: ProgramAction; motors: string[]; servos: string[]; onArgs: (args: ProgramAction["args"]) => void }) {
  const set = (key: string, value: string | number | boolean) => onArgs({ ...action.args, [key]: value });
  if (action.kind === "drive" || action.kind === "turn") return <div className="form-stack"><label className="field"><span>Direction</span><select value={String(action.args.direction)} onChange={(event) => set("direction", event.target.value)}>{(action.kind === "drive" ? ["forward", "backward", "left", "right"] : ["left", "right"]).map((direction) => <option key={direction}>{direction}</option>)}</select></label><RangeField label="Power" value={Number(action.args.power)} min={0} max={1} step={0.05} onChange={(value) => set("power", value)} /><label className="field"><span>Duration <small>milliseconds</small></span><input type="number" min={0} value={Number(action.args.duration)} onChange={(event) => set("duration", Math.max(0, Number(event.target.value)))} /></label></div>;
  if (action.kind === "wait") return <label className="field"><span>Wait duration <small>milliseconds</small></span><input type="number" min={0} value={Number(action.args.duration)} onChange={(event) => set("duration", Math.max(0, Number(event.target.value)))} /></label>;
  if (action.kind === "motor") return <div className="form-stack"><label className="field"><span>Motor</span><select value={String(action.args.device)} onChange={(event) => set("device", event.target.value)}>{motors.map((device) => <option key={device}>{device}</option>)}</select></label><RangeField label="Power" value={Number(action.args.power)} min={-1} max={1} step={0.05} onChange={(value) => set("power", value)} /></div>;
  if (action.kind === "servo") return <div className="form-stack"><label className="field"><span>Servo</span><select value={String(action.args.device)} onChange={(event) => set("device", event.target.value)}>{servos.map((device) => <option key={device}>{device}</option>)}</select></label><RangeField label="Position" value={Number(action.args.position)} min={0} max={1} step={0.05} onChange={(value) => set("position", value)} /></div>;
  return <p className="muted">{action.kind === "stop" ? "Stop has no parameters. It places actuators into their safe state." : "Open Paths to configure the complete Pedro path."}</p>;
}

function RangeField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <label className="field range-field"><span>{label}<output>{value.toFixed(2)}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function createAction(kind: ProgramAction["kind"], motor: string, servo: string): ProgramAction {
  const args: ProgramAction["args"] = kind === "drive" ? { direction: "forward", power: 0.4, duration: 750 } : kind === "turn" ? { direction: "right", power: 0.3, duration: 500 } : kind === "wait" ? { duration: 250 } : kind === "motor" ? { device: motor, power: 0.25 } : kind === "servo" ? { device: servo, position: 0.5 } : kind === "path" ? { mode: "linear", values: "72, 96, 0, 0" } : {};
  const action: ProgramAction = { id: `action-${crypto.randomUUID()}`, kind, label: labelFor(kind, args), enabled: true, args, source: "", leadingComments: [] };
  action.source = actionToSource(action);
  return action;
}

function labelFor(kind: ProgramAction["kind"], args: ProgramAction["args"]) {
  if (kind === "drive") return `Drive ${args.direction}`;
  if (kind === "turn") return `Turn ${args.direction}`;
  if (kind === "wait") return "Wait";
  if (kind === "motor") return `Set motor ${args.device}`;
  if (kind === "servo") return `Set servo ${args.device}`;
  if (kind === "path") return "Follow Pedro path";
  if (kind === "stop") return "Stop all motion";
  return "Custom action";
}

function summarize(action: ProgramAction) {
  if (action.kind === "drive" || action.kind === "turn") return `${action.args.power} power for ${action.args.duration} ms`;
  if (action.kind === "wait") return `${action.args.duration} ms`;
  if (action.kind === "motor") return `${action.args.device} at ${action.args.power} power`;
  if (action.kind === "servo") return `${action.args.device} to ${action.args.position}`;
  if (action.kind === "path") return "Pedro Pathing segment";
  if (action.kind === "stop") return "Safe end state";
  return action.source;
}

function explanationFor(kind: ProgramAction["kind"]) {
  if (kind === "drive" || kind === "turn") return "Power controls effort, while duration controls how long the motors receive that command. Timed motion is useful for learning, but Pedro paths are more repeatable for competition autonomous.";
  if (kind === "motor") return "Motor power ranges from -1 to 1. Start low when the robot is eventually connected and make sure the mechanism has room to move.";
  if (kind === "servo") return "Servo position is normalized from 0 to 1. Physical limits can be narrower, so verify the mechanism before applying extreme positions.";
  if (kind === "wait") return "A wait blocks the next sequential action. Parallel actions may continue, which will become visible in the program timeline.";
  if (kind === "path") return "Pedro paths use localization and feedback to follow field geometry more reliably than timed motor power.";
  return "A declared stop makes program behavior predictable and gives every actuator a safe end state.";
}

function listDevices(manifest: Record<string, unknown>, key: string, fallback: string[]) {
  return Array.isArray(manifest[key]) && (manifest[key] as unknown[]).every((value) => typeof value === "string") ? manifest[key] as string[] : fallback;
}
