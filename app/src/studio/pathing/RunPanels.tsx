import { useEffect, useState, type ReactNode } from "react";
import { PanelLeft, PanelRight, Play, Plug, Square } from "lucide-react";
import { describeReport, LIVE_OPMODE_NAME, pedroDevices, readMechanisms, type LiveProgram, type Pose, type Program, type Project, type ScannedDevice, type ScannedPedro } from "../../core";
import type { DesktopSimulator, LaunchFailure } from "../../desktop/robotProject";
import type { SimulatorStartup } from "../useDesktop";
import { RunComparison } from "../RunComparison";
import { isRunTimingKey } from "../runTimings";
import { Section } from "./LayersPanel";
import { SCREEN_BUTTONS, type RunSession } from "./useRunSession";
import { DataPanel, type PlannedMotion } from "./DataPanel";

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
  /** Lumière Live: this computer's pairing secret, when Live runs are on. */
  live?: { secret: string };
  /** Desktop: a simulator launch in progress. */
  startup?: SimulatorStartup | null;
  /** Desktop: why the last simulator launch failed. */
  startupError?: LaunchFailure | null;
  dismissStartupError?(): void;
  /** Opens the build output under the workspace. */
  showOutput?(): void;
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

/** What to do next once the simulator is connected. */
function readyText(session: RunSession) {
  if (session.phase === "running") return `Running "${session.active ?? session.mode}". STOP ends it, and the match timer stops it.`;
  if (session.phase === "init") return `"${session.active ?? session.mode}" is initialized. Press START.`;
  if (!session.mode) return "Choose an OpMode to run.";
  return `Ready: press RUN, or INIT, then START, under the field.`;
}

const LAUNCH_STAGES: { stage: SimulatorStartup["stage"]; label: string }[] = [
  { stage: "saving", label: "Saving and deploying your code" },
  { stage: "building", label: "Building it with Gradle" },
  { stage: "starting", label: "Starting the simulator" },
];

/** A simulator launch as it goes: each stage, the time so far and the latest build line. */
function LaunchProgress({ startup }: { startup: SimulatorStartup }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const current = LAUNCH_STAGES.findIndex((item) => item.stage === startup.stage);
  const seconds = Math.max(0, Math.floor((now - startup.startedAt) / 1000));
  return <div className="pv-launch" role="status" aria-label="Simulator startup">
    <ol className="pv-launch-steps">
      {LAUNCH_STAGES.map((item, index) => <li key={item.stage} className={index < current ? "done" : index === current ? "current" : undefined}>
        {item.label}{index === current && <span className="pv-launch-time"> · {seconds} s</span>}
      </li>)}
    </ol>
    {startup.line && <code className="pv-launch-line" title={startup.line}>{startup.line}</code>}
    <p className="pv-note">The first launch can take several minutes while Gradle downloads and compiles. Later launches are quicker.</p>
  </div>;
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
  /** What this computer sends Lumière Live, or null when it can't send this program. */
  liveProgram?: LiveProgram | null;
  onHide(): void;
}

/** Lumière Live in Robot mode: whether this computer is paired, and what the robot found in the program it sent. */
function LiveSection({ session, program, env, liveProgram }: { session: RunSession; program: Program; env: RunEnvironment; liveProgram?: LiveProgram | null }) {
  const report = session.live;
  if (!env.live && !report) return null;
  const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
  let body: ReactNode;
  if (!env.live) {
    body = <p className="pv-note">{LIVE_OPMODE_NAME} is initialized on the robot. Turn on Live runs on the Robot page to send programs from this computer.</p>;
  } else if (program.kind !== "autonomous") {
    body = <p className="pv-note">{LIVE_OPMODE_NAME} runs autonomous programs. Open one to send it.</p>;
  } else if (!liveProgram) {
    body = <p className="pv-note">Fix the problems listed under Problems first. {LIVE_OPMODE_NAME} gets the same program a deploy would.</p>;
  } else if (!report) {
    const robot = session.connected && session.hello?.source === "robot";
    body = robot && !session.hello?.capabilities?.live
      ? <p className="pv-note">This robot's robot library predates {LIVE_OPMODE_NAME}. Update the robot library in TeamCode, then deploy and install the robot code.</p>
      : robot && session.modes.length > 0 && !session.modes.some((item) => item.name === LIVE_OPMODE_NAME)
        ? <p className="pv-note">{LIVE_OPMODE_NAME} isn't installed on this robot yet. With Live runs on, deploy and install the robot code; the Driver Station then lists it.</p>
        : <p className="pv-note">On the Driver Station, choose {LIVE_OPMODE_NAME} and press INIT. This computer then sends "{program.name}" for the robot to check, and START runs it.</p>;
  } else {
    const summary = report.program;
    const stale = summary && summary.revision !== liveProgram.revision;
    const run = report.run;
    // A closed report is how the last run ended; it stays until the next INIT.
    const ended = report.state === "closed";
    const seconds = (report.silenceMs / 1000).toLocaleString();
    const passed = summary && `"${summary.name}" passed: ${count(summary.steps, "step")}, ${count(summary.paths, "path")}, ${count(summary.mechanisms, "mechanism")}.`;
    body = <>
      <p className="pv-chip-line">
        <span className={`pv-chip${report.paired ? "" : " muted"}`}>{ended ? "Ended" : report.paired ? "Paired" : "Pairing…"}</span>
        {report.dryRun
          ? <span className="pv-chip">Dry run: nothing moves</span>
          : <span className="pv-chip">Mechanism power limit {report.powerCap}</span>}
      </p>
      {run?.phase === "finished"
        ? <p className="pv-live-result ok" role="status">{summary ? `"${summary.name}"` : "The program"} finished{run.elapsedMs !== undefined ? ` in ${(run.elapsedMs / 1000).toFixed(1)} s` : ""}. {ended ? `To run it again, INIT ${LIVE_OPMODE_NAME} on the Driver Station.` : "The robot holds its last pose until the Driver Station stops it."}</p>
        : run?.phase === "stopped" || (ended && run?.phase === "running")
          ? <p className="pv-live-result bad" role="alert">Stopped. {run.phase === "stopped" ? run.reason : `${LIVE_OPMODE_NAME} ended during the run.`}</p>
          : run?.phase === "not run"
            ? <p className="pv-live-result bad" role="status">Not run. {run.reason}</p>
            : !summary
              ? <p className="pv-note">{report.paired ? "Sending the program…" : "Pairing with the robot…"}</p>
              : report.state === "checking"
                ? <p className="pv-note">Checking "{summary.name}" against the robot's hardware…</p>
                : run?.phase === "running"
                  ? <p className="pv-live-result ok" role="status">Running "{summary.name}" from this computer. Keep this window open: {LIVE_OPMODE_NAME} stops if it doesn't hear from this computer for {seconds} s.</p>
                  : report.state === "accepted"
                    ? <p className="pv-live-result ok" role="status">{passed} {report.dryRun ? "This robot's Lumière Live is a dry run: START moves nothing." : "Press START on the Driver Station to run it."}</p>
                    : <div className="pv-live-result bad" role="status">
                      <p>"{summary.name}" can't run on this robot: {count(report.problems.length, "problem")}.</p>
                      <ul>{report.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
                    </div>}
      {report.notes.length > 0 && <ul className="pv-note pv-live-notes">{report.notes.map((note) => <li key={note}>{note}</li>)}</ul>}
      {stale && report.started && !ended && <p className="pv-note">The robot has an older version of this program. Stop {LIVE_OPMODE_NAME} and INIT it again to send this one.</p>}
    </>;
  }
  const untraveled = env.live && liveProgram ? motorsWithoutTravel(liveProgram) : [];
  return <Section title={LIVE_OPMODE_NAME}>
    {body}
    {untraveled.length > 0 && <p className="pv-note">Give {untraveled.join(", ")} a travel range on the Robot page (Mechanisms). {LIVE_OPMODE_NAME} refuses encoder targets without one.</p>}
    {session.liveError && <p className="pv-live-result bad" role="alert">{session.liveError}</p>}
    {env.live && <p className="pv-note">Before competitions, turn Live runs off and deploy, so {LIVE_OPMODE_NAME} leaves the robot code.</p>}
  </Section>;
}

/** Motors the program sends to encoder targets without a travel range, which Lumière Live refuses. */
function motorsWithoutTravel(program: LiveProgram): string[] {
  const names: string[] = [];
  for (const mechanism of program.mechanisms) {
    for (const device of mechanism.devices) {
      const targets = mechanism.states.some((state) => state.outputs[device.id]?.kind === "target");
      if (device.kind === "motor" && targets && !device.travel) names.push(`"${device.name.trim()}" in ${mechanism.name}`);
    }
  }
  return names;
}

/** The left panel in Simulate and Robot: how to start the simulator or reach the robot, and what to run. */
export function RunPanel({ mode, session, project, program, env, routine, liveProgram, onHide }: RunPanelProps) {
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
          {env.startup && <LaunchProgress startup={env.startup}/>}
          {env.startupError && <div className="pv-live-result bad" role="alert">
            <p><strong>{env.startupError.summary}</strong></p>
            {env.startupError.detail && <code className="pv-launch-line">{env.startupError.detail}</code>}
            <p>{env.startupError.hint}</p>
            <div className="pv-actions">
              {env.showOutput && <button type="button" onClick={env.showOutput}>Show build output</button>}
              {env.dismissStartupError && <button type="button" onClick={env.dismissStartupError}>Dismiss</button>}
            </div>
          </div>}
          <div className="pv-actions">
            {session.linked
              ? <button type="button" onClick={session.disconnect}>Disconnect</button>
              : <button type="button" className="primary" disabled={!!env.busy || !env.canLaunch} onClick={session.open}><Plug/>Launch simulator</button>}
            {env.busy && <button type="button" onClick={env.cancel}>Cancel startup</button>}
          </div>
          {session.connected && <p className="pv-note" role="status">{readyText(session)}</p>}
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
        <LiveSection session={session} program={program} env={env} liveProgram={liveProgram}/>
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
  /** The state the plan has each mechanism in at the time shown, by mechanism id. */
  planned?: Record<string, string>;
  /** The run being compared with this program's plan: which OpMode, whether it is the program's own, and what the ghost is. */
  comparison?: { opMode: string; own: boolean; ghost: string };
  /** The plan at a time since START, for the graphs. */
  planAt?(t: number): PlannedMotion | undefined;
  /** How far a point is from the planned path, for the graphs. */
  offPlanAt?(x: number, y: number): number;
  onHide(): void;
}

/** The right panel in Simulate and Robot: what the simulator or robot reports, and how runs compare. */
export function TelemetryPanel({ session, project, program, estimated, offPath, planned, comparison, planAt, offPlanAt, onHide }: TelemetryPanelProps) {
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
        {comparison && <p className="pv-note" role="status">{comparison.own
          ? `The ghost is ${comparison.ghost}.`
          : `Comparing "${comparison.opMode}" with this program's plan, as if the robot started at its start pose. The ghost is ${comparison.ghost}.`}</p>}
      </Section>
      <MechanismsSection project={project} session={session} planned={planned}/>
      {session && <DataPanel history={session.history} live={session.phase === "running"} planAt={planAt} offPlanAt={offPlanAt} planLabel={comparison?.ghost}/>}
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

/**
 * Each mechanism's state: what the simulator's devices show now, and what the plan has at the same time.
 * Devices the team's code drives outside any mechanism are listed too, except Pedro Pathing's own.
 */
function MechanismsSection({ project, session, planned }: { project: Project; session?: RunSession; planned?: Record<string, string> }) {
  const reports = session?.source === "simulator" ? session.devices : {};
  const live = Object.keys(reports).length > 0;
  if (!live && !(planned && project.subsystems.length)) return null;
  const readings = readMechanisms(project.subsystems, reports);
  const stateName = (subsystemId: string, stateId?: string | null) =>
    project.subsystems.find((item) => item.id === subsystemId)?.states.find((item) => item.id === stateId)?.name;
  const modeled = new Set(project.subsystems.flatMap((item) => item.devices.map((device) => device.name.trim())));
  const pedro = new Set(pedroDevices(project.robot).map((device) => device.name));
  const others = Object.entries(reports).filter(([name]) => !modeled.has(name) && !pedro.has(name));
  const kindOf = (type: string) => (type === "servo" || type === "crservo" ? type : "motor");
  return <Section title="Mechanisms" count={project.subsystems.length || undefined}>
    {project.subsystems.length
      ? <dl className="pv-mechanisms" aria-label="Mechanism states">
        {readings.map(({ subsystem, stateId, devices }) => <div key={subsystem.id}>
          <dt>{subsystem.name}</dt>
          <dd>
            {live && <span className="pv-mech-now">{stateName(subsystem.id, stateId) ?? "No state matches"}</span>}
            {planned && <span className="pv-mech-plan">Plan: {stateName(subsystem.id, planned[subsystem.id]) ?? "not set yet"}</span>}
            {live && <ul>{devices.map(({ device, report }) => <li key={device.id}>{device.name}: {describeReport(device, report)}</li>)}</ul>}
          </dd>
        </div>)}
      </dl>
      : <p className="pv-note">Add mechanisms on the Robot page to see their states here.</p>}
    {others.length > 0 && <details className="pv-other-devices">
      <summary>Other devices ({others.length})</summary>
      <ul>{others.map(([name, report]) => <li key={name}>{name}: {describeReport({ kind: kindOf(report.type), reversed: false }, report)}</li>)}</ul>
    </details>}
  </Section>;
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
      <button type="button" className="pv-run-button go" title="INIT, then START" disabled={!session.connected || !session.mode || session.phase === "running"} onClick={session.run}><Play/>RUN</button>
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
