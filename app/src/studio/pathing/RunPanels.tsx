import type { ReactNode } from "react";
import { PanelLeft, PanelRight, Plug, Square } from "lucide-react";
import type { Pose, Program, Project, ScannedDevice, ScannedPedro } from "../../core";
import type { DesktopSimulator } from "../../desktop/robotProject";
import { RunComparison } from "../RunComparison";
import { isRunTimingKey } from "../runTimings";
import { Section } from "./LayersPanel";
import { SCREEN_BUTTONS, type RunSession } from "./useRunSession";

/** What the workbench lends the run modes: the desktop simulator, the robot's address and deploys. */
export interface RunEnvironment {
  /** Whether this is the desktop app, which runs the Java simulator. */
  desktop: boolean;
  /** The desktop task in progress, if any. */
  busy: string;
  canLaunch: boolean;
  launch(): Promise<DesktopSimulator | undefined>;
  cancel(): void;
  onLog(text: string): void;
  /** The simulator's setup: SDK link, deploy settings and robot model. Desktop only. */
  simulatorSetup?: ReactNode;
  host: string;
  onHost(host: string): void;
  onScan(devices: ScannedDevice[], pedro?: ScannedPedro): void;
  /** Desktop deploys, offered when an FTC SDK project is linked. */
  deployCode?(): void;
  deployApk?(): void;
  onRobotSetup(): void;
}

const FOLLOWER = new Map([["follow", "Following a path"], ["hold", "Holding position"], ["manual", "Manual drive"], ["idle", "Idle"]]);
const show = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value) ?? String(value));
const degrees = (radians: number) => (((radians * 180) / Math.PI) % 360 + 360) % 360;

type Drivetrain = NonNullable<NonNullable<RunSession["hello"]>["drivetrain"]>;

/** Where the follower's pose comes from: through Pedro Pathing in the simulator, whatever the robot's localizer. */
function poseSource(drivetrain: Drivetrain, localizer?: string) {
  if (drivetrain.pose === "pedro") return `Pose through Pedro Pathing${localizer ? `, standing in for ${localizer}` : ""}`;
  return drivetrain.localizer ?? "No localizer reported";
}

/** The measured speeds and decelerations the simulator drives with, from the robot's Pedro constants. */
function kinematicsLine(kinematics: Drivetrain["kinematics"]) {
  if (!kinematics) return "";
  const pair = (a?: number, b?: number) => [a, b].map((value) => (value === undefined ? "—" : value.toFixed(1))).join(" / ");
  const speeds = kinematics.forwardVelocity !== undefined || kinematics.strafeVelocity !== undefined ? `${pair(kinematics.forwardVelocity, kinematics.strafeVelocity)} in/s` : "";
  const coasting = kinematics.forwardDeceleration !== undefined || kinematics.strafeDeceleration !== undefined ? `coasting ${pair(kinematics.forwardDeceleration, kinematics.strafeDeceleration)} in/s²` : "";
  const parts = [speeds, coasting].filter(Boolean);
  return parts.length ? `From your Pedro constants: ${parts.join(", ")}` : "";
}

function Status({ session }: { session: RunSession }) {
  const state = session.connected ? "on" : session.linked ? "waiting" : "off";
  return <p className="pv-status" role="status"><i className={`pv-status-dot ${state}`} aria-hidden="true"/>{session.status}</p>;
}

/** The estimate's label: whose numbers it uses. */
export function estimateLabel(project: Project) {
  const constants = project.robot.constants;
  return `Estimate · ${constants ? "your Pedro constants" : "robot profile"}${constants?.tuned === false ? " (untuned)" : ""}`;
}

export interface RunPanelProps {
  mode: "simulate" | "robot";
  /** None in the web app's Simulate, which plays the estimate. */
  session?: RunSession;
  project: Project;
  program: Program;
  env: RunEnvironment;
  /** The planned routine, shown under the controls. */
  routine?: ReactNode;
  onHide(): void;
}

/** The left panel in Simulate and Robot: how to start the simulator or reach the robot, and what to run. */
export function RunPanel({ mode, session, project, program, env, routine, onHide }: RunPanelProps) {
  const title = mode === "robot" ? "Robot" : session ? "Simulator" : "Preview";
  return <aside className="pv-panel pv-run-panel" aria-label={`${title} controls`}>
    <div className="pv-panel-head">
      <h2>{title}</h2>
      <button type="button" className="pv-icon small" aria-label="Hide controls" title="Hide controls" onClick={onHide}><PanelLeft/></button>
    </div>
    <div className="pv-panel-scroll">
      {!session ? <Section title="Estimate">
        <p className="pv-chip-line"><span className="pv-chip wide">{estimateLabel(project)}</span></p>
        <p className="pv-note">{program.kind === "autonomous"
          ? "Plays the routine as the robot profile's speeds, braking and turn rate allow. The desktop app runs your Java, mechanisms and gamepads in its simulator."
          : "TeleOp runs in the desktop app's simulator, driven by your gamepad or keyboard."}</p>
      </Section> : session.source === "simulator" ? <>
        <Section title="Simulator">
          <Status session={session}/>
          <div className="pv-actions">
            {session.linked
              ? <button type="button" onClick={session.disconnect}>Disconnect</button>
              : <button type="button" className="primary" disabled={!!env.busy || !env.canLaunch} onClick={session.open}><Plug/>Launch simulator</button>}
            {env.busy && <button type="button" onClick={env.cancel}>Cancel startup</button>}
          </div>
          {env.simulatorSetup}
        </Section>
        <Section title="OpMode">
          <label className="pv-field-label"><span>OpMode</span>
            <select className="pv-input" value={session.mode} disabled={session.phase === "running"} onChange={(event) => session.setMode(event.target.value)}>
              <option value="">Choose an OpMode</option>
              {session.modes.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.flavor}</option>)}
            </select>
          </label>
          <label className="pv-field-label"><span>Match timer</span>
            <select className="pv-input" value={session.limit} onChange={(event) => session.setLimit(Number(event.target.value))}>
              <option value="30">Autonomous · 0:30</option>
              <option value="120">TeleOp · 2:00</option>
            </select>
          </label>
        </Section>
        <Section title="Gamepad">
          <label className="pv-check"><input type="checkbox" checked={session.keyboard} onChange={(event) => session.setKeyboard(event.target.checked)}/>Keyboard gamepad: WASD, Q/E turn, J/K/U/I buttons</label>
          <div className="pv-pad">
            {SCREEN_BUTTONS.map((button) => <button key={button} type="button" disabled={!session.connected}
              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); session.press(button, true); }}
              onPointerUp={() => session.press(button, false)} onPointerCancel={() => session.press(button, false)}>{button.toUpperCase()}</button>)}
          </div>
          <p className="pv-note">A standard USB gamepad takes priority when connected.</p>
        </Section>
      </> : <>
        <Section title="Connection">
          <label className="pv-field-label"><span>Control Hub address</span>
            <input className="pv-input" value={env.host} disabled={session.linked} placeholder="192.168.43.1" onChange={(event) => env.onHost(event.target.value)}/>
          </label>
          <Status session={session}/>
          <div className="pv-actions">
            {session.linked
              ? <button type="button" onClick={session.disconnect}>Disconnect</button>
              : <button type="button" className="primary" disabled={session.finding} onClick={session.open}><Plug/>Connect robot</button>}
            <button type="button" disabled={session.linked || session.finding} onClick={session.find}>{session.finding ? "Finding robot…" : "Find robot"}</button>
          </div>
        </Section>
        <Section title="OpMode">
          <p className="pv-active" role="status"><strong>{session.active ? `${session.active} · ${session.phase.toUpperCase()}` : "None reported"}</strong></p>
          <p className="pv-note">Start robot OpModes from the Driver Station. This connection reads telemetry and can request STOP.</p>
        </Section>
        {env.desktop && <Section title="Deploy">
          <div className="pv-actions">
            <button type="button" disabled={!env.deployCode || !!env.busy} onClick={env.deployCode}>Deploy code</button>
            <button type="button" disabled={!env.deployApk || !!env.busy} onClick={env.deployApk}>Deploy APK</button>
          </div>
          <button type="button" className="pv-ghost-button" onClick={env.onRobotSetup}>Robot setup</button>
        </Section>}
      </>}
      {routine}
    </div>
  </aside>;
}

export interface TelemetryPanelProps {
  session?: RunSession;
  project: Project;
  program: Program;
  /** The pose and speed the estimate gives, when no simulator or robot reports one. */
  estimated?: { pose: Pose; speed: number };
  /** How far the reported pose is from the planned path, in inches. */
  offPath?: number;
  onHide(): void;
}

/** The right panel in Simulate and Robot: what the simulator or robot reports, and how runs compare. */
export function TelemetryPanel({ session, project, program, estimated, offPath, onHide }: TelemetryPanelProps) {
  const pose = session ? session.pose : estimated?.pose;
  const values = session ? Object.entries(session.data).filter(([key]) => !isRunTimingKey(key)) : [];
  const readouts = [
    { label: "X", value: pose ? pose.x.toFixed(1) : "—", unit: "in" },
    { label: "Y", value: pose ? pose.y.toFixed(1) : "—", unit: "in" },
    { label: "Heading", value: pose ? degrees(pose.heading).toFixed(0) : "—", unit: "°" },
    session ? { label: "Off plan", value: offPath === undefined ? "—" : offPath.toFixed(1), unit: "in" }
      : { label: "Speed", value: estimated ? estimated.speed.toFixed(0) : "—", unit: "in/s" },
  ];
  return <aside className="pv-panel pv-telemetry" aria-label="Telemetry">
    <div className="pv-panel-head">
      <h2>Telemetry</h2>
      <button type="button" className="pv-icon small" aria-label="Hide telemetry" title="Hide telemetry" onClick={onHide}><PanelRight/></button>
    </div>
    <div className="pv-panel-scroll">
      <Section title="Robot">
        <dl className="pv-readouts" aria-label="Robot pose">
          {readouts.map(({ label, value, unit }) => <div key={label}><dt>{label}</dt><dd>{value}<span>{unit}</span></dd></div>)}
        </dl>
        {session?.target && <p className="pv-note">Follower target: {session.target.x.toFixed(1)}, {session.target.y.toFixed(1)} in at {degrees(session.target.heading).toFixed(0)}°</p>}
        {session && <ul className="pv-legend" aria-label="Field key">
          {program.kind === "autonomous" && <li><i className="planned" aria-hidden="true"/>Plan, faded, with a ghost robot where it says the robot should be</li>}
          <li><i className="driven" aria-hidden="true"/>Where the robot drove</li>
          <li><i className="follower" aria-hidden="true"/>The follower's path and target</li>
        </ul>}
      </Section>
      {session && <Section title="Follower">
        <dl className="pv-pairs">
          <div><dt>Loop time</dt><dd>{session.loopMs === undefined ? "Not reported" : `${session.loopMs.toFixed(1)} ms`}</dd></div>
          <div><dt>Follower</dt><dd>{session.follower ? FOLLOWER.get(session.follower) ?? session.follower : session.loopMs === undefined ? "Not reported" : "None attached"}</dd></div>
        </dl>
      </Section>}
      {session && <Section title="Telemetry">
        {session.hello
          ? <p className="pv-note">{session.hello.source} · library {session.hello.library}{session.hello.drivetrain && <><br/>{poseSource(session.hello.drivetrain, session.localizer)}</>}
            {kinematicsLine(session.hello.drivetrain?.kinematics) && <><br/>{kinematicsLine(session.hello.drivetrain?.kinematics)}</>}</p>
          : <p className="pv-note">{session.source === "robot" ? "Connect to the robot to see what it reports." : "Launch the simulator to see what your OpMode reports."}</p>}
        {session.source === "simulator" && <pre className="pv-telemetry-lines">{session.telemetry.length ? session.telemetry.join("\n") : "Waiting for telemetry…"}</pre>}
      </Section>}
      {session && <Section title="Session data" count={values.length || undefined}>
        {values.length
          ? <dl className="pv-pairs">{values.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{show(value)}</dd></div>)}</dl>
          : <p className="pv-note">Values the OpMode reports with Session.data appear here.</p>}
      </Section>}
      <RunComparison key={project.id} projectId={project.id} opModeName={program.name}/>
    </div>
  </aside>;
}

export interface RunBarProps {
  session: RunSession;
  /** The match length the track shows, in milliseconds. */
  limitMs: number;
  /** Where the plan has each path end, when this run is the program's own OpMode. */
  markers: { ms: number; color: string; name: string }[];
}

/** INIT, START and STOP with the run's clock, under the field in Simulate and Robot. */
export function RunBar({ session, limitMs, markers }: RunBarProps) {
  const percent = (ms: number) => Math.max(0, Math.min(100, (ms / limitMs) * 100));
  const simulator = session.source === "simulator";
  return <div className="pv-playback pv-runbar">
    {simulator && <>
      <button type="button" className="pv-run-button" disabled={!session.connected || !session.mode || session.phase === "running"} onClick={session.init}>INIT</button>
      <button type="button" className="pv-run-button go" disabled={!session.connected || session.phase !== "init"} onClick={session.start}>START</button>
    </>}
    <button type="button" className="pv-run-button stop" disabled={!session.connected} onClick={session.stop}><Square/>STOP</button>
    <div className="pv-track" title={`${(limitMs / 1000).toFixed(0)} s match`}>
      <div className="pv-track-fill" style={{ width: `${percent(session.elapsed)}%` }}/>
      {markers.map((marker, index) => <span key={index} className="pv-marker planned" style={{ left: `${percent(marker.ms)}%`, background: marker.color }} title={marker.name} aria-hidden="true"/>)}
    </div>
    <span className="pv-time"><b>{session.phase.toUpperCase()} · {(session.elapsed / 1000).toFixed(1)} s</b></span>
  </div>;
}
