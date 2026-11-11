import { useEffect, useRef, useState } from "react";
import {
  findRobot, fromBrowserGamepad, robotStreamUrl, StreamClient,
  type ConnectionStatus, type GamepadStateMessage, type OpModeInfo, type Phase, type Point, type PoseMessage,
  fromSimulator, LIVE_OPMODE_NAME, readDeviceReports, readLiveReport, type DeviceReport, type HardwareDevice, type LiveProgram, type LiveReport, type ScannedDevice, type ScannedPedro, type ServerMessage, type SocketFactory,
} from "../../core";
import type { DesktopSimulator } from "../../desktop/robotProject";
import { RunRecorder, saveRunTiming } from "../runTimings";

export type RunSource = "simulator" | "robot";

/** One moment of a run, kept ten times a second from START, for the graphs and the simulated-run ghost. */
export interface RunSample {
  /** Time since START, in milliseconds. */
  t: number;
  x: number;
  y: number;
  /** Radians. */
  heading: number;
  loopMs?: number;
  /** Numeric Session.data values at that moment. */
  data: Record<string, number>;
  /** Simulator: each device's outputs. */
  devices?: Record<string, DeviceReport>;
}

const SAMPLE_MS = 100;
/** Five minutes of samples. */
const HISTORY_LIMIT = 3000;
export type Hello = Extract<ServerMessage, { type: "hello" }>;
export const SCREEN_BUTTONS = ["a", "b", "x", "y"] as const;
export type ScreenButton = typeof SCREEN_BUTTONS[number];

const PHASES: Phase[] = ["idle", "init", "running", "stopped"];
/** Keyboard keys that drive the simulator's gamepad 1: WASD to drive, Q/E to turn, J/K/U/I for A/B/X/Y. */
const GAMEPAD_KEYS = ["w", "a", "s", "d", "q", "e", "j", "k", "u", "i"];
/** The trail keeps a point every half inch, up to this many. */
const TRAIL_STEP = 0.5;
const TRAIL_LIMIT = 2000;

/** Frames come from the network, so values are checked before they are drawn or formatted. */
/** How often a connection pings, and how often while paired with Lumière Live, in milliseconds. */
const PING_MS = 2000;
export const LIVE_PING_MS = 250;
const finite = (pose?: PoseMessage) => (pose && [pose.x, pose.y, pose.heading].every(Number.isFinite) ? pose : undefined);

/** The manifest's report of what Pedro Pathing drives, checked and bounded like the device list. */
function scannedPedro(value: unknown): ScannedPedro | undefined {
  if (!value || typeof value !== "object") return undefined;
  const pedro = value as { constants?: unknown; localizer?: unknown; devices?: unknown };
  if (typeof pedro.constants !== "string" || !Array.isArray(pedro.devices)) return undefined;
  const devices = pedro.devices
    .filter((device): device is { name: string; role: string } => !!device && typeof device.name === "string" && typeof device.role === "string" && device.role.length > 0)
    .slice(0, 40).map((device) => ({ role: device.role.slice(0, 40), name: device.name.slice(0, 80) }));
  return { constants: pedro.constants.slice(0, 200), localizer: typeof pedro.localizer === "string" ? pedro.localizer.slice(0, 40) : null, devices };
}

export interface RunSessionOptions {
  source: RunSource;
  projectId: string;
  /** The program's name, which is also its OpMode's name. */
  programName: string;
  onLog(text: string): void;
  /** Simulator: starts the desktop simulator for this program. */
  launch?(): Promise<DesktopSimulator | undefined>;
  /** Simulator: cancels a startup in progress. */
  cancel?(): void;
  canLaunch?: boolean;
  /** Simulator: the robot's hardware list, to read a simulator from before robot library 0.4.0. */
  hardware?: HardwareDevice[];
  /** Robot: the Control Hub's address. */
  host?: string;
  onHost?(host: string): void;
  /** Robot: the hardware its configuration lists, from the manifest, and what Pedro Pathing drives. */
  onScan?(devices: ScannedDevice[], pedro?: ScannedPedro): void;
  /**
   * Robot: this computer's Lumière Live pairing, and the program to send. When the robot reports
   * Lumière Live initialized, the session pairs and sends the program, and sends it again when it changes.
   */
  live?: { secret: string; program: LiveProgram | null };
  /** Tests replace the WebSocket. */
  socketFactory?: SocketFactory;
}

export interface RunSession {
  source: RunSource;
  /** "Disconnected", "Connecting…", "Connected" or "Reconnecting…". */
  status: string;
  /** Whether a connection exists, including while it reconnects. */
  linked: boolean;
  connected: boolean;
  finding: boolean;
  hello?: Hello;
  /** OpModes the simulator reports, and the one chosen for INIT. */
  modes: OpModeInfo[];
  mode: string;
  setMode(name: string): void;
  phase: Phase;
  /** The OpMode the stream reports as initialized or running. */
  active: string | null;
  /** The simulator's true pose, or the robot follower's estimate. */
  pose?: PoseMessage;
  /** The team's Pedro Pathing localizer the simulator stands in for, such as ThreeWheelIMULocalizer. */
  localizer?: string;
  /** Robot: Lumière Live's latest report while it is initialized or running. */
  live?: LiveReport;
  /** Robot: why the robot refused this computer's pairing or program. */
  liveError?: string;
  /** The follower's target pose and the path it reports following. */
  target?: PoseMessage;
  route?: [number, number][];
  /** Where the robot has driven since START. */
  trail: Point[];
  telemetry: string[];
  /** Simulator: each device's outputs, by configured name. Empty until the simulator reports them. */
  devices: Record<string, DeviceReport>;
  /** The run so far, ten samples a second from START; cleared at INIT. */
  history: RunSample[];
  data: Record<string, unknown>;
  loopMs?: number;
  follower?: string;
  /** Time since START in milliseconds: the simulator's clock, or measured here for a robot. */
  elapsed: number;
  /** Simulator: the match timer in seconds, after which it presses STOP. */
  limit: number;
  setLimit(seconds: number): void;
  /** Simulator: whether the keyboard drives gamepad 1. */
  keyboard: boolean;
  setKeyboard(on: boolean): void;
  /** Simulator: presses or releases an on-screen gamepad button. */
  press(button: ScreenButton, down: boolean): void;
  /** Launches the simulator, or connects to the robot at `host`. */
  open(): void;
  /** Robot: looks for a Robot Controller on robot Wi-Fi and connects to it. */
  find(): void;
  disconnect(): void;
  init(): void;
  start(): void;
  /** Simulator: INIT the chosen OpMode, then START it once the simulator reports it initialized. */
  run(): void;
  stop(): void;
}

/**
 * A stream connection to the desktop simulator or a robot, and everything it reports. The connection
 * lives as long as the component that owns it: unmounting presses STOP and shuts a simulator down.
 */
export function useRunSession(options: RunSessionOptions): RunSession {
  const { source } = options;
  const robot = source === "robot";
  // Stream handlers outlive the render that created them, so they read the latest options here.
  const latest = useRef(options);
  latest.current = options;
  const [connection, setConnection] = useState<ConnectionStatus>("closed");
  const [linked, setLinked] = useState(false);
  const [opened, setOpened] = useState(false);
  const [finding, setFinding] = useState(false);
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [active, setActive] = useState<string | null>(null);
  const [modes, setModes] = useState<OpModeInfo[]>([]);
  const [mode, setMode] = useState("");
  const [pose, setPose] = useState<PoseMessage>();
  const [localizer, setLocalizer] = useState<string>();
  const [target, setTarget] = useState<PoseMessage>();
  const [route, setRoute] = useState<[number, number][]>();
  const [trail, setTrail] = useState<Point[]>([]);
  const [telemetry, setTelemetry] = useState<string[]>([]);
  const [devices, setDevices] = useState<Record<string, DeviceReport>>({});
  const [history, setHistory] = useState<RunSample[]>([]);
  const historyNow = useRef<RunSample[]>([]);
  const latestData = useRef<Record<string, number>>({});
  const latestLoop = useRef<number | undefined>(undefined);
  /** A hub's latest device outputs, kept with each sample of the run. */
  const latestDevices = useRef<Record<string, DeviceReport> | undefined>(undefined);
  /** Whether the OpMode is running, as the latest message said; React state lags behind a burst of messages. */
  const runningNow = useRef(false);
  /** Keeps a sample at most every SAMPLE_MS of run time. */
  const sample = (t: number, pose: PoseMessage, reports?: Record<string, DeviceReport>) => {
    const last = historyNow.current[historyNow.current.length - 1];
    if (!Number.isFinite(t) || (last && t - last.t < SAMPLE_MS)) return;
    const next: RunSample = { t, x: pose.x, y: pose.y, heading: pose.heading, loopMs: latestLoop.current, data: { ...latestData.current }, ...(reports ? { devices: reports } : {}) };
    historyNow.current = [...historyNow.current.slice(-(HISTORY_LIMIT - 1)), next];
    setHistory(historyNow.current);
  };
  /** Set by Run: START follows as soon as the simulator reports the OpMode initialized. */
  const autoStart = useRef(false);
  const [live, setLive] = useState<LiveReport>();
  const [liveError, setLiveError] = useState<string>();
  const liveReport = useRef<LiveReport | undefined>(undefined);
  const liveSent = useRef({ auth: false, failed: false, revision: null as string | null });
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loopMs, setLoopMs] = useState<number>();
  const [follower, setFollower] = useState<string>();
  const [hello, setHello] = useState<Hello>();
  const [elapsed, setElapsed] = useState(0);
  const [limit, setLimit] = useState(30);
  const [keyboard, setKeyboardState] = useState(false);
  const client = useRef<StreamClient | null>(null);
  const sim = useRef<DesktopSimulator | null>(null);
  const alive = useRef(true);
  const starting = useRef(false);
  const epoch = useRef(0);
  const runStart = useRef<number | null>(null);
  const phaseNow = useRef<Phase>("idle");
  const trailNow = useRef<Point[]>([]);
  const streamSource = useRef<Hello["source"]>(source);
  /** The robot library version the stream's hello gave. */
  const library = useRef<string | undefined>(undefined);
  const keys = useRef(new Set<string>());
  const screen = useRef<GamepadStateMessage>({});

  const setPhase = (next: Phase) => { phaseNow.current = next; setPhaseState(next); };
  const resetTrail = () => { trailNow.current = []; setTrail([]); };
  /** Keeps the robot's path while it runs, a point every half inch. */
  const record = (next: PoseMessage) => {
    if (phaseNow.current !== "running") return;
    const last = trailNow.current[trailNow.current.length - 1];
    if (last && Math.hypot(next.x - last.x, next.y - last.y) < TRAIL_STEP) return;
    trailNow.current = [...trailNow.current.slice(-(TRAIL_LIMIT - 1)), { x: next.x, y: next.y }];
    setTrail(trailNow.current);
  };
  const showPose = (next: PoseMessage) => { setPose(next); record(next); };

  /** Drops the client; for the simulator it also presses STOP, shuts the simulator down, and cancels its task. */
  const release = () => {
    const stream = client.current;
    const running = sim.current;
    client.current = null;
    sim.current = null;
    runStart.current = null;
    epoch.current++;
    if (!robot) {
      stream?.stop();
      stream?.shutdown();
      void running?.task.cancel().catch(() => {});
    }
    stream?.close();
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (starting.current) latest.current.cancel?.();
      release();
    };
  }, []);

  /** What one OpMode run reported; cleared at INIT. */
  const clearRun = () => {
    setRoute(undefined); setTarget(undefined); setData({}); setDevices({}); setLoopMs(undefined); setFollower(undefined); setLocalizer(undefined); resetTrail();
    historyNow.current = []; setHistory([]); latestData.current = {}; latestLoop.current = undefined; latestDevices.current = undefined;
  };
  const clearLive = () => {
    liveSent.current = { auth: false, failed: false, revision: null };
    liveReport.current = undefined;
    setLive(undefined);
    setLiveError(undefined);
    client.current?.setPingInterval(PING_MS);
  };
  /**
   * While this computer is paired with Lumière Live, it pings several times a second: the robot only
   * starts a run, and keeps it going, while it hears from the paired computer.
   */
  const pace = () => {
    const paired = !!liveReport.current?.paired && liveSent.current.auth && !liveSent.current.failed;
    client.current?.setPingInterval(paired ? LIVE_PING_MS : PING_MS);
  };
  /**
   * Pairs with Lumière Live, then sends the program once the robot reports this connection paired.
   * Nothing is sent once it has started, and a refused pairing is not retried on this connection.
   */
  const sendLive = () => {
    const live = latest.current.live;
    const report = liveReport.current;
    const stream = client.current;
    if (!robot || !live || !stream || !report || report.state === "closed" || report.started) return;
    if (!liveSent.current.auth) {
      liveSent.current.auth = stream.send({ type: "auth", token: live.secret });
      return;
    }
    if (liveSent.current.failed || !report.paired || !live.program || liveSent.current.revision === live.program.revision) return;
    if (stream.send({ type: "program", program: live.program })) liveSent.current.revision = live.program.revision;
  };
  const clearStream = () => {
    clearLive();
    autoStart.current = false;
    runStart.current = null;
    setHello(undefined); setModes([]); setMode(""); setActive(null); setPhase("idle");
    setElapsed(0); setPose(undefined); setTelemetry([]); clearRun();
  };
  const disconnect = () => { release(); setLinked(false); setConnection("closed"); clearStream(); };
  /** A hub sends no elapsed time, so robot mode times the run itself: from START, frozen at STOP, reset at the next INIT. */
  const time = (next: Phase) => {
    const now = performance.now();
    if (next === "running") {
      if (runStart.current === null) { runStart.current = now; setElapsed(0); }
      return;
    }
    if (next === "stopped" && runStart.current !== null) setElapsed(now - runStart.current);
    if (next === "init" || next === "idle") setElapsed(0);
    runStart.current = null;
  };
  const receive = (message: ServerMessage) => {
    if (message.type === "hello") {
      setHello(message);
      library.current = typeof message.library === "string" ? message.library : undefined;
      streamSource.current = message.source === "simulator" ? "simulator" : "robot";
    } else if (message.type === "manifest") {
      const list = Array.isArray(message.opModes) ? message.opModes.filter((item) => item && typeof item.name === "string" && typeof item.flavor === "string") : [];
      setModes(list);
      const name = latest.current.programName;
      setMode((current) => (list.some((item) => item.name === current) ? current : list.find((item) => item.name === name)?.name ?? list[0]?.name ?? ""));
      // A hub's manifest lists its configured hardware; during startup it may still be empty.
      if (streamSource.current === "robot" && Array.isArray(message.devices)) {
        const devices = message.devices.filter((device) => device && typeof device.name === "string" && typeof device.type === "string").slice(0, 300)
          .map((device) => ({ name: device.name.slice(0, 80), type: device.type.slice(0, 80) }));
        if (devices.length) latest.current.onScan?.(devices, scannedPedro(message.pedro));
      }
    } else if (message.type === "lifecycle" && PHASES.includes(message.phase)) {
      setActive(typeof message.opMode === "string" ? message.opMode : null);
      if (typeof message.opMode === "string" && message.phase !== "stopped") setMode(message.opMode);
      if (message.phase === "init") {
        clearRun(); setTelemetry([]);
        if (robot) setPose(undefined);
        if (!liveReport.current) setLive(undefined);
      }
      // Run: START follows INIT. A previous OpMode's "stopped" can come in between, so only INIT or a start ends the wait.
      if (autoStart.current && message.phase === "init" && !robot) { autoStart.current = false; client.current?.start(); }
      if (message.phase === "running") autoStart.current = false;
      runningNow.current = message.phase === "running";
      setPhase(message.phase);
      if (robot) time(message.phase);
    } else if (message.type === "robot") {
      // The simulator's `robot` pose is the true pose; `state.pose` is the follower's estimate, used only for a hub.
      if (PHASES.includes(message.phase)) { setPhase(message.phase); runningNow.current = message.phase === "running"; }
      const next = finite(message.pose);
      if (next) showPose(next);
      if (Number.isFinite(message.elapsed)) setElapsed(message.elapsed * 1000);
      if (typeof message.localizer === "string") setLocalizer(message.localizer.slice(0, 80));
      const reports = message.devices ? fromSimulator(readDeviceReports(message.devices), library.current, latest.current.hardware) : undefined;
      if (reports) setDevices(reports);
      if (next && message.phase === "running") sample(message.elapsed * 1000, next, reports);
    } else if (message.type === "state") {
      const next = finite(message.pose);
      if (next && streamSource.current === "robot") showPose(next);
      setTarget(finite(message.target));
      setLoopMs(Number.isFinite(message.loopMs) ? message.loopMs : undefined);
      setFollower(typeof message.follower === "string" ? message.follower : undefined);
      const values = message.data;
      if (values && typeof values === "object" && !Array.isArray(values)) {
        setData((current) => ({ ...current, ...values }));
        for (const [key, value] of Object.entries(values)) if (typeof value === "number" && Number.isFinite(value)) latestData.current[key] = value;
      }
      latestLoop.current = Number.isFinite(message.loopMs) ? message.loopMs : undefined;
      // A hub's run is timed here from START; the simulator's samples come with its own clock.
      if (next && streamSource.current === "robot" && runningNow.current && runStart.current !== null) sample(performance.now() - runStart.current, next, latestDevices.current);
    } else if (message.type === "devices") {
      // Any OpMode on a hub: what the SDK last sent each motor and servo.
      const reports = readDeviceReports(message.devices);
      latestDevices.current = reports;
      setDevices(reports);
    } else if (message.type === "path") {
      setRoute(Array.isArray(message.points) ? message.points.filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])) : undefined);
    } else if (message.type === "telemetry") {
      setTelemetry(Array.isArray(message.lines) ? message.lines.map(String) : []);
    } else if (message.type === "live") {
      const report = robot ? readLiveReport(message) : null;
      if (!report) return;
      if (report.state === "closed") {
        clearLive();
        // How a run ended stays shown, and the run stays drawn against the plan, until the next INIT.
        if (report.started && report.run) setLive(report);
        return;
      }
      liveReport.current = report;
      setLive(report);
      if (report.paired) setLiveError(undefined);
      sendLive();
      pace();
    } else if (message.type === "error") {
      latest.current.onLog(message.message);
      // On a hub, errors without an OpMode answer this computer's Lumière Live pairing or program.
      if (robot && !message.opMode && !message.stack) {
        setLiveError(message.message);
        if (liveSent.current.auth && liveSent.current.revision === null) liveSent.current.failed = true;
        pace();
      }
    }
  };
  /** Replaces any existing client, so one view never holds two connections. Events from a replaced client are ignored. */
  const connect = (url: string, token?: string) => {
    const previous = client.current;
    const stream = new StreamClient({ url, token, socketFactory: latest.current.socketFactory });
    const recorder = new RunRecorder(source);
    client.current = stream;
    previous?.close();
    epoch.current++;
    streamSource.current = source;
    setLinked(true);
    setOpened(false);
    clearStream();
    stream.onStatus((status) => {
      if (client.current !== stream) return;
      setConnection(status);
      if (status === "open") setOpened(true);
      if (status === "closed") { recorder.reset(); clearStream(); }
    });
    stream.onMessage((message) => {
      if (client.current !== stream) return;
      const timing = recorder.receive(message, performance.now());
      // A Lumière Live run is filed under the program it ran, not under Lumière Live.
      const ran = liveReport.current?.program?.name;
      if (timing) saveRunTiming(latest.current.projectId, timing.opMode === LIVE_OPMODE_NAME && ran ? { ...timing, opMode: ran } : timing);
      receive(message);
    });
    stream.connect();
  };
  const find = async () => {
    setFinding(true);
    const at = epoch.current;
    const found = await findRobot();
    if (!alive.current) return;
    setFinding(false);
    if (epoch.current !== at) return;
    if (found) { latest.current.onHost?.(found.host); connect(robotStreamUrl(found.host)); }
    else latest.current.onLog("No robot found. Join robot Wi-Fi and try again.");
  };
  const open = async () => {
    const { host = "192.168.43.1", launch, canLaunch = true } = latest.current;
    if (robot) { connect(robotStreamUrl(host)); return; }
    if (starting.current || !canLaunch || !launch) return;
    starting.current = true;
    const running = await launch().finally(() => { starting.current = false; });
    if (!alive.current) { void running?.task.cancel().catch(() => {}); return; }
    if (!running) return;
    sim.current = running;
    connect(running.url, running.token);
    void running.task.result.catch((error) => { if (sim.current === running) latest.current.onLog(String(error)); }).finally(() => {
      if (sim.current !== running) return;
      const stream = client.current;
      client.current = null;
      sim.current = null;
      stream?.close();
      setLinked(false);
      setConnection("closed");
      setPhase("stopped");
    });
  };

  // A hub's run is timed here, so the clock ticks while it runs.
  useEffect(() => {
    if (!robot || phase !== "running") return;
    const timer = setInterval(() => { if (runStart.current !== null) setElapsed(performance.now() - runStart.current); }, 100);
    return () => clearInterval(timer);
  }, [robot, phase]);
  // The simulator's match timer presses STOP when time runs out.
  useEffect(() => {
    if (!robot && phase === "running" && elapsed >= limit * 1000) client.current?.stop();
  }, [elapsed, phase, limit, robot]);
  // Gamepad 1 for the simulator: a standard USB gamepad, or the keyboard and on-screen buttons.
  useEffect(() => {
    if (robot || connection !== "open") return;
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (keyboard && !/INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName) && GAMEPAD_KEYS.includes(key)) {
        keys.current.add(key);
        event.preventDefault();
      }
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase());
    const blur = () => {
      keys.current.clear();
      screen.current = {};
      client.current?.gamepad(1, { left_stick_x: 0, left_stick_y: 0, right_stick_x: 0, a: false, b: false, x: false, y: false });
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    const timer = setInterval(() => {
      const pad = Array.from(navigator.getGamepads?.() ?? []).find((item) => item?.mapping === "standard");
      const held = keys.current;
      client.current?.gamepad(1, pad ? fromBrowserGamepad(pad) : {
        left_stick_x: (held.has("d") ? 1 : 0) - (held.has("a") ? 1 : 0),
        left_stick_y: (held.has("s") ? 1 : 0) - (held.has("w") ? 1 : 0),
        right_stick_x: (held.has("e") ? 1 : 0) - (held.has("q") ? 1 : 0),
        a: held.has("j"), b: held.has("k"), x: held.has("u"), y: held.has("i"),
        ...screen.current,
      });
    }, 50);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      blur();
    };
  }, [robot, connection, keyboard]);

  // A new program, or Live runs turned on while Lumière Live waits, is sent without waiting for another report.
  const liveRevision = options.live?.program?.revision;
  const liveSecret = options.live?.secret;
  useEffect(() => { sendLive(); }, [liveRevision, liveSecret]);

  return {
    source,
    status: !linked ? "Disconnected" : connection === "open" ? "Connected" : opened ? "Reconnecting…" : "Connecting…",
    linked, connected: connection === "open", finding, hello, modes, mode, setMode, phase, active,
    pose, localizer, target, route, trail, telemetry, devices, history, data, loopMs, follower, elapsed, limit, setLimit,
    keyboard,
    setKeyboard: (on) => { keys.current.clear(); setKeyboardState(on); },
    press: (button, down) => { screen.current = { ...screen.current, [button]: down }; },
    open: () => void open(),
    find: () => void find(),
    disconnect,
    live, liveError,
    init: () => { if (mode) client.current?.initOpMode(mode); },
    start: () => { client.current?.start(); },
    run: () => {
      const stream = client.current;
      if (!stream || robot || !mode || phase === "running") return;
      if (phase === "init" && active === mode) { stream.start(); return; }
      autoStart.current = stream.initOpMode(mode);
    },
    stop: () => { autoStart.current = false; client.current?.stop(); },
  };
}
