// Virtual REV Control Hub for development. Runs a robot project's OpModes on the desktop simulator's
// robot and serves the unmodified robot library's stream on port 58080, as a real hub does, with a
// Driver Station console here. Nothing it uses is shipped: see README.md in this folder.
//
//   node dev/virtual-hardware/virtual-hub.mjs [--project <dir>] [--create]   interactive Driver Station
//   node dev/virtual-hardware/virtual-hub.mjs --check                          robot-stream contract checks
//   node dev/virtual-hardware/virtual-hub.mjs --shakedown                      driving, faulty OpModes, restart
//   node dev/virtual-hardware/virtual-hub.mjs --run "Example Auto" [--seconds 12]
//   node dev/virtual-hardware/virtual-hub.mjs --script "until app; init Example Auto; start; wait 20; stop"
//   node dev/virtual-hardware/virtual-hub.mjs --probe [--pedro 3.0.2]          Pedro heading probe
//
// Common options: --config <simulator.json>  --pedro <version>  --offline
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback; };

if (flag("--help")) {
  console.log(readUsage());
  process.exit(0);
}

const project = resolve(value("--project", resolve(here, "work/robot-project")));
const mode = flag("--check") ? "check" : flag("--shakedown") ? "shakedown" : flag("--probe") ? "probe"
  : value("--run") ? "run" : value("--script") ? "script" : "console";
const ROBOT_PORT = 58080;
const DEFAULT_OPMODE = "$Stop$Robot$";

if (!existsSync(resolve(project, "TeamCode"))) {
  if (!flag("--create")) fail(`No robot project at ${project}. Pass --create to generate one from the quickstart (robot library from this checkout).`);
  console.log(`Creating a robot project at ${project} ...`);
  const made = spawnSync(process.execPath, [resolve(repo, "scripts/quickstart.mjs"), "--out", project, "--robot-library", "local"], { stdio: "inherit" });
  if (made.status !== 0) process.exit(made.status ?? 1);
}

// ---------------------------------------------------------------------------------------------
// Launch through the robot project's unit-test task, with the harness added by the init script.

const token = randomBytes(24).toString("hex");
const testClass = mode === "probe" ? "dev.lumiere.devtools.virtualhub.PedroHeadingProbe" : "dev.lumiere.devtools.virtualhub.RunVirtualHub";
const gradleArgs = [":TeamCode:testDebugUnitTest", "--tests", testClass, "--init-script", resolve(here, "virtual-hub.init.gradle"), "--console=plain"];
if (flag("--offline")) gradleArgs.push("--offline");
const env = {
  ...process.env,
  ...androidSdkEnvironment(),
  VH_HARNESS: resolve(here, "harness/java"),
  VH_TOKEN: token,
  ...(mode === "probe" ? { VH_PROBE: "true" } : { VH_DS_PORT: "0" }),
  // The contract check connects while the robot is still starting, as an app reconnecting after a restart would.
  ...(mode === "check" ? { VH_BOOT_DELAY_MS: "3000" } : {}),
  ...(mode === "shakedown" ? { VH_FAULTS: "true" } : {}),
  ...(value("--config") ? { VH_CONFIG: resolve(value("--config")) } : {}),
  ...(value("--pedro") ? { VH_PEDRO: value("--pedro") } : {}),
};
const gradle = process.platform === "win32"
  ? spawn("cmd.exe", ["/d", "/c", resolve(project, "gradlew.bat"), ...gradleArgs], { cwd: project, env })
  : spawn(resolve(project, "gradlew"), gradleArgs, { cwd: project, env });

let output = "";
let ready;
const readyPromise = new Promise((done) => { ready = done; });
// In check mode an app client connects as soon as the robot library's stream is up.
let earlyApp = null;
let buffered = "";
const onData = (chunk) => {
  const text = chunk.toString();
  output = (output + text).slice(-20_000);
  buffered += text;
  const lines = buffered.split(/\r?\n/);
  buffered = lines.pop();
  for (const line of lines) {
    if (/^\s*\[(hub|probe)\]/.test(line)) say(line.trim());
    if (mode === "check" && !earlyApp && /VIRTUAL_HUB_STREAM_UP/.test(line)) {
      earlyApp = appClient(ROBOT_PORT);
      earlyApp.catch(() => {}); // Reported by the check that awaits it.
    }
    const match = /VIRTUAL_HUB_READY robot=(\d+) ds=(\d+)/.exec(line);
    if (match) ready({ robot: Number(match[1]), ds: Number(match[2]) });
  }
};
gradle.stdout.on("data", onData);
gradle.stderr.on("data", onData);
const exited = new Promise((done) => gradle.on("exit", (code) => done(code)));
let ds = null;
let pad = {};
process.on("SIGINT", () => { dsSend({ type: "shutdown" }); setTimeout(() => process.exit(130), 3000); });

if (mode === "probe") {
  const code = await exited;
  if (code !== 0) console.error(output.slice(-6000));
  process.exit(code ?? 1);
}

let started = false;
const ports = await new Promise((done, failStart) => {
  const timer = setTimeout(() => failStart(new Error(`The virtual hub did not start within 10 minutes.\n${output.slice(-6000)}`)), 600_000);
  readyPromise.then((found) => { started = true; clearTimeout(timer); done(found); });
  exited.then((code) => { if (!started) { clearTimeout(timer); failStart(new Error(`Gradle exited with ${code} before the virtual hub started.\n${output.slice(-6000)}`)); } });
}).catch((error) => fail(error.message));
say(`Virtual hub ready. App robot stream: ws://127.0.0.1:${ports.robot}/stream (Lumière's Robot view: address 127.0.0.1)`);

// ---------------------------------------------------------------------------------------------
// Driver Station connection (token-protected, loopback only).

ds = new WebSocket(`ws://127.0.0.1:${ports.ds}/stream`);
const dsState = { phase: "idle", opMode: null, opModes: [], telemetry: [], truth: null, errors: [] };
const dsLog = [];
let dsListeners = [];
ds.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  dsLog.push(message);
  if (message.type === "manifest") dsState.opModes = message.opModes;
  if (message.type === "lifecycle") { dsState.phase = message.phase; dsState.opMode = message.opMode; }
  if (message.type === "telemetry") dsState.telemetry = message.lines;
  if (message.type === "robot") dsState.truth = message;
  if (message.type === "error") dsState.errors.push(message);
  dsListeners.forEach((listener) => listener(message));
});
await new Promise((done, failOpen) => {
  ds.addEventListener("open", done, { once: true });
  ds.addEventListener("error", () => failOpen(new Error("Could not connect to the Driver Station channel.")), { once: true });
});
ds.send(JSON.stringify({ type: "auth", token }));
const dsPinger = setInterval(() => dsSend({ type: "ping", t: Date.now() }), 2000);
function dsSend(message) { if (ds?.readyState === WebSocket.OPEN) ds.send(JSON.stringify(message)); }
const dsNext = (match, ms = 30_000) => waitFor(dsLog, (listener) => { dsListeners.push(listener); return () => { dsListeners = dsListeners.filter((l) => l !== listener); }; }, match, ms);
await dsNext((m) => m.type === "manifest");

async function shutdown(code) {
  clearInterval(dsPinger);
  dsSend({ type: "shutdown" });
  const exitCode = await Promise.race([exited, new Promise((done) => setTimeout(() => done("timeout"), 15_000))]);
  if (exitCode === "timeout") gradle.kill();
  ds.close();
  process.exit(code);
}

if (mode === "run") await runOnce();
else if (mode === "check") await shutdown(await check());
else if (mode === "shakedown") await shutdown(await shakedown());
else if (mode === "script") await runScript(value("--script"));
else await console_();

// ---------------------------------------------------------------------------------------------

async function runOnce() {
  const name = value("--run");
  const seconds = Number(value("--seconds", "12"));
  dsSend({ type: "init", opMode: name });
  await dsNext((m) => m.type === "lifecycle" && m.phase === "init");
  await sleep(500);
  dsSend({ type: "start" });
  await dsNext((m) => m.type === "lifecycle" && m.phase === "running");
  await sleep(seconds * 1000);
  dsSend({ type: "stop" });
  await dsNext((m) => m.type === "lifecycle" && m.phase === "stopped");
  const pose = dsState.truth?.pose;
  say(`After ${seconds} s: x ${pose?.x} y ${pose?.y} heading ${pose ? (pose.heading * 180 / Math.PI).toFixed(1) : "?"}°`);
  say(`Telemetry: ${JSON.stringify(dsState.telemetry)}`);
  if (dsState.errors.length) say(`Errors: ${dsState.errors.map((e) => e.message).join("; ")}`);
  await shutdown(dsState.errors.length ? 1 : 0);
}

/** Reports Driver Station events the way a Driver Station screen would. */
function echoDriverStation() {
  let lastTelemetry = "";
  dsListeners.push((message) => {
    if (message.type === "lifecycle") say(`phase: ${message.phase}${message.opMode ? ` (${message.opMode})` : ""}`);
    if (message.type === "error") say(`error: ${message.message}${message.stack?.[0] ? ` at ${message.stack[0].class}.${message.stack[0].method}:${message.stack[0].line}` : ""}`);
    if (message.type === "telemetry") {
      const text = message.lines.join(" | ");
      if (text !== lastTelemetry) { lastTelemetry = text; say(`telemetry: ${text}`); }
    }
  });
}

/** Runs one Driver Station command. Returns false for quit. */
async function command(line) {
  const [name, ...rest] = line.trim().split(/\s+/);
  switch ((name ?? "").toLowerCase()) {
    case "": break;
    case "list": dsState.opModes.forEach((m, i) => say(`${i + 1}. ${m.name} (${m.flavor}${m.group ? `, ${m.group}` : ""})`)); break;
    case "init": {
      const text = rest.join(" ");
      const chosen = /^\d+$/.test(text) ? dsState.opModes[Number(text) - 1]?.name : text;
      dsSend({ type: "init", opMode: chosen });
      break;
    }
    case "start": dsSend({ type: "start" }); break;
    case "stop": dsSend({ type: "stop" }); break;
    case "drive": {
      const [forward = 0, strafe = 0, turn = 0] = rest.map(Number);
      pad = { ...pad, left_stick_y: -forward, left_stick_x: strafe, right_stick_x: turn };
      dsSend({ type: "gamepad", index: 1, state: pad });
      break;
    }
    case "pad":
      if (rest[0] === "reset") pad = {};
      else for (const pair of rest) {
        const [key, raw] = pair.split("=");
        pad[key] = raw === "true" ? true : raw === "false" ? false : Number(raw);
      }
      dsSend({ type: "gamepad", index: 1, state: pad });
      break;
    case "place": {
      const [x, y, degrees = 0] = rest.map(Number);
      dsSend({ type: "place", x, y, heading: degrees * Math.PI / 180 });
      break;
    }
    case "status": {
      const t = dsState.truth;
      say(`${dsState.phase}${dsState.opMode ? ` (${dsState.opMode})` : ""} · app clients on the robot stream: ${t?.appClients ?? "?"}`);
      if (t) say(`true pose x ${t.pose.x} y ${t.pose.y} heading ${(t.pose.heading * 180 / Math.PI).toFixed(1)}° · ${t.voltage} V · ${t.elapsed} s`);
      break;
    }
    case "telemetry": say(dsState.telemetry.join("\n") || "(none)"); break;
    case "restart": dsSend({ type: "restart" }); break;
    // Script helpers.
    case "wait": await sleep(Number(rest[0] ?? 1) * 1000); break;
    case "until": {
      const what = rest.join(" ");
      const limit = Date.now() + 300_000;
      const met = () => what === "app" ? dsState.truth?.appConnected === true
        : what === "no app" ? dsState.truth?.appConnected === false
        : dsState.phase === what;
      while (!met()) {
        if (Date.now() > limit) throw new Error(`gave up waiting for "${what}" after 5 minutes`);
        await sleep(100);
      }
      say(`reached: ${what}`);
      break;
    }
    case "quit": case "exit": return false;
    default: say(`Unknown command "${name}".`);
  }
  return true;
}

async function console_() {
  say("Driver Station console. Commands: list, init <name|number>, start, stop, drive <fwd> <strafe> <turn>,");
  say("  pad <field>=<value> ... | pad reset, place <x> <y> <deg>, status, telemetry, restart, wait <s>, until <app|phase>, quit");
  echoDriverStation();
  const lines = createInterface({ input: process.stdin, output: process.stdout, prompt: "ds> " });
  lines.prompt();
  for await (const line of lines) {
    try {
      if (!(await command(line))) { lines.close(); break; }
    } catch (error) {
      say(String(error));
    }
    lines.prompt();
  }
  await shutdown(0);
}

/** Runs semicolon-separated console commands, for example "until app; init Example Auto; start; wait 20; stop". */
async function runScript(script) {
  echoDriverStation();
  try {
    for (const line of script.split(";")) {
      if (!line.trim()) continue;
      say(`ds> ${line.trim()}`);
      if (!(await command(line))) break;
    }
  } catch (error) {
    say(String(error));
    await shutdown(1);
  }
  await shutdown(dsState.errors.length ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------
// Contract checks: what Lumière's Robot view relies on from a Control Hub, and the stream's safety rules.

/** PASS/FAIL bookkeeping shared by --check and --shakedown. */
function suite() {
  const results = [];
  const record = (name, pass, detail = "") => { results.push({ name, pass, detail }); say(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };
  const attempt = async (name, body) => {
    try { const detail = await body(); record(name, true, detail ?? ""); } catch (error) { record(name, false, error.message); }
  };
  const finish = () => {
    const failed = results.filter((r) => !r.pass);
    say(`${results.length - failed.length}/${results.length} checks passed.`);
    return failed.length ? 1 : 0;
  };
  return { attempt, finish };
}

async function check() {
  const { attempt, finish } = suite();

  await attempt("An app that connects while the Robot Controller starts gets the OpModes and hardware once it has started", async () => {
    expect(earlyApp, "the stream-up line was not seen");
    const early = await earlyApp;
    const first = await early.next((m) => m.type === "manifest");
    expect(!first.opModes.some((m) => m.name === "Example Auto"), "OpModes were already registered when the early client connected; the window was not exercised");
    const refreshed = await early.next((m) => m.type === "manifest" && m.opModes.some((o) => o.name === "Example Auto"), 15_000);
    expect(refreshed.devices.length > 0, "the refreshed manifest has no devices");
    expect(!early.log.some((m) => m.type === "lifecycle"), "the startup refresh sent a lifecycle message");
    early.close();
    return `first manifest: ${first.opModes.length} OpModes; refreshed: ${refreshed.opModes.length} OpModes, ${refreshed.devices.length} devices`;
  });

  const idle = idleClient(ports.robot);
  const app = await appClient(ports.robot);

  await attempt("Robot stream greets like a Control Hub, without a token", async () => {
    const hello = await app.next((m) => m.type === "hello");
    expect(hello.source === "robot", `source is ${hello.source}`);
    expect(hello.protocol === 1, `protocol is ${hello.protocol}`);
    expect(typeof hello.library === "string" && hello.library.length > 0, "no library version");
    expect(hello.drivetrain === undefined, "simulator-only drivetrain field present");
    return `library ${hello.library}`;
  });
  await attempt("Manifest lists the project's OpModes, configured hardware and Pedro Pathing's devices before any INIT, without the SDK's system OpMode", async () => {
    const manifest = await app.next((m) => m.type === "manifest");
    const names = manifest.opModes.map((m) => m.name);
    expect(names.includes("Example Auto") && names.includes("Example TeleOp"), `got ${names.join(", ")}`);
    expect(!names.includes(DEFAULT_OPMODE), "the SDK's default OpMode is listed");
    const auto = manifest.opModes.find((m) => m.name === "Example Auto");
    expect(auto.flavor === "autonomous", `Example Auto flavor ${auto.flavor}`);
    const devices = manifest.devices.map((d) => `${d.name}:${d.type}`);
    expect(devices.filter((d) => d.endsWith(":motor")).length >= 4, `devices ${devices.join(", ") || "none"}`);
    // Pedro Pathing's own constants name its devices; every one must be in the configuration.
    const pedro = manifest.pedro;
    expect(pedro && Array.isArray(pedro.devices), "no pedro block: the project's Pedro constants were not found");
    const roles = pedro.devices.map((d) => d.role);
    expect(["frontLeft", "frontRight", "backLeft", "backRight"].every((role) => roles.includes(role)), `Pedro roles ${roles.join(", ")}`);
    const configured = new Set(manifest.devices.map((d) => d.name));
    const missing = pedro.devices.filter((d) => !configured.has(d.name)).map((d) => `${d.role} ${d.name}`);
    expect(!missing.length, `Pedro devices missing from the configuration: ${missing.join(", ")}`);
    return `${names.length} OpModes, ${devices.length} devices; Pedro: ${pedro.localizer}, ${pedro.devices.map((d) => `${d.role}=${d.name}`).join(" ")}`;
  });
  await attempt("No lifecycle before the first OpMode", async () => {
    await sleep(500);
    expect(!app.log.some((m) => m.type === "lifecycle"), "a lifecycle message arrived");
  });
  await attempt("The desktop app's origin is accepted", async () => {
    const status = await upgradeStatus(ports.robot, "http://tauri.localhost");
    expect(status === 101, `HTTP ${status}`);
    return "HTTP 101";
  });
  await attempt("Web pages from other origins are refused", async () => {
    const status = await upgradeStatus(ports.robot, "https://example.com");
    expect(status === 403, `HTTP ${status}`);
    return "HTTP 403";
  });
  await attempt("Robot stream ignores INIT, START, gamepad, place and shutdown", async () => {
    for (const message of [{ type: "init", opMode: "Example Auto" }, { type: "start" }, { type: "gamepad", index: 1, state: { a: true } }, { type: "place", x: 10, y: 10, heading: 0 }, { type: "shutdown" }]) app.send(message);
    app.send({ type: "ping", t: 1 });
    await app.next((m) => m.type === "pong" && m.t === 1);
    await sleep(800);
    expect(dsState.phase === "idle", `Driver Station phase became ${dsState.phase}`);
    expect(!app.log.some((m) => m.type === "error"), "the robot stream replied with an error");
  });

  const initAt = app.log.length;
  await attempt("Driver Station INIT reaches the app with the configured hardware", async () => {
    dsSend({ type: "init", opMode: "Example Auto" });
    const manifest = await app.next((m) => m.type === "manifest", 15_000, initAt);
    const lifecycle = await app.next((m) => m.type === "lifecycle" && m.phase === "init", 15_000, initAt);
    expect(lifecycle.opMode === "Example Auto", `opMode ${lifecycle.opMode}`);
    const devices = manifest.devices.map((d) => `${d.name}:${d.type}`);
    expect(devices.filter((d) => d.endsWith(":motor")).length >= 4, `devices ${devices.join(", ")}`);
    return devices.join(", ");
  });
  await sleep(700);
  const startAt = app.log.length;
  await attempt("Driver Station START reaches the app", async () => {
    dsSend({ type: "start" });
    await app.next((m) => m.type === "lifecycle" && m.phase === "running", 15_000, startAt);
  });
  await attempt("Pose and path stream while the OpMode runs, at most 20 times a second", async () => {
    const path = await app.next((m) => m.type === "path", 15_000, startAt);
    expect(path.points.length === 65, `${path.points.length} path points`);
    await app.next((m) => m.type === "state" && m.pose, 15_000, startAt);
    const from = app.log.length;
    await sleep(3000);
    const states = app.log.slice(from).filter((m) => m.type === "state");
    const rate = states.length / 3;
    expect(rate <= 21, `${rate.toFixed(1)} per second`);
    expect(rate >= 5, `${rate.toFixed(1)} per second`);
    expect(states.every((m) => m.opMode === "Example Auto"), "state for another OpMode");
    return `${rate.toFixed(1)} state messages per second, follower ${states.at(-1)?.follower}`;
  });
  await attempt("The robot moves along the path", async () => {
    const states = app.log.slice(startAt).filter((m) => m.type === "state" && m.pose);
    const first = states[0].pose, last = states.at(-1).pose;
    const moved = Math.hypot(last.x - first.x, last.y - first.y);
    expect(moved > 5, `moved ${moved.toFixed(1)} in`);
    return `moved ${moved.toFixed(1)} in, now (${last.x.toFixed(1)}, ${last.y.toFixed(1)})`;
  });
  const stopAt = app.log.length;
  await attempt("STOP from the app stops the OpMode", async () => {
    app.send({ type: "stop" });
    await app.next((m) => m.type === "lifecycle" && m.phase === "stopped", 15_000, stopAt);
    await dsNext((m) => m.type === "lifecycle" && m.phase === "stopped");
  });
  await attempt("The SDK's default OpMode is never reported", async () => {
    await sleep(500);
    expect(!app.log.some((m) => m.opMode === DEFAULT_OPMODE), "a message named the default OpMode");
    const after = app.log.slice(stopAt).filter((m) => m.type === "lifecycle").map((m) => m.phase);
    expect(after.join(",") === "stopped", `lifecycle after stop: ${after.join(", ")}`);
  });
  await attempt("A late client receives the current manifest and lifecycle", async () => {
    const late = await appClient(ports.robot);
    await late.next((m) => m.type === "hello");
    const manifest = await late.next((m) => m.type === "manifest");
    const lifecycle = await late.next((m) => m.type === "lifecycle");
    expect(manifest.devices.length > 0, "manifest without devices");
    expect(lifecycle.phase === "stopped" && lifecycle.opMode === "Example Auto", `lifecycle ${lifecycle.phase} ${lifecycle.opMode}`);
    late.close();
  });
  const teleAt = app.log.length;
  await attempt("STOP from the app also works during INIT", async () => {
    dsSend({ type: "init", opMode: "Example TeleOp" });
    await app.next((m) => m.type === "lifecycle" && m.phase === "init" && m.opMode === "Example TeleOp", 15_000, teleAt);
    await sleep(500);
    app.send({ type: "stop" });
    await app.next((m) => m.type === "lifecycle" && m.phase === "stopped" && m.opMode === "Example TeleOp", 15_000, teleAt);
    expect(!app.log.slice(teleAt).some((m) => m.type === "lifecycle" && m.phase === "running"), "it started running");
  });
  await attempt("Driver Station telemetry and the true pose stay off the robot stream", async () => {
    const leaked = app.log.filter((m) => m.type === "telemetry" || m.type === "robot");
    expect(leaked.length === 0, `${leaked.length} simulator messages reached the app`);
    expect(dsLog.some((m) => m.type === "telemetry" && m.lines.length > 0), "the Driver Station got no telemetry");
  });
  await attempt("Silent clients are disconnected after 10 s, as docs/protocol.md says", async () => {
    const seconds = await idle;
    expect(seconds >= 9 && seconds <= 15, `closed after ${seconds.toFixed(1)} s${seconds < 9 ? " (NanoHTTPD's socket read timeout, 5 s, fires before StreamServer's 10 s watchdog)" : ""}`);
    return `closed after ${seconds.toFixed(1)} s`;
  });
  await attempt("No OpMode errors on the Driver Station", async () => {
    expect(dsState.errors.length === 0, dsState.errors.map((e) => e.message).join("; "));
  });

  app.close();
  return finish();
}

// ---------------------------------------------------------------------------------------------
// Shakedown: driving, misbehaving OpModes, awkward data, two apps, and a robot restart.

async function shakedown() {
  const { attempt, finish } = suite();
  const app = await appClient(ports.robot);
  await app.next((m) => m.type === "manifest");

  /** Runs one OpMode from the Driver Station and returns where its messages start in the app's log. */
  const begin = async (name, { start = true } = {}) => {
    const from = app.log.length;
    dsSend({ type: "init", opMode: name });
    await app.next((m) => m.type === "lifecycle" && m.phase === "init" && m.opMode === name, 15_000, from);
    if (start) {
      await sleep(400);
      dsSend({ type: "start" });
      await app.next((m) => m.type === "lifecycle" && m.phase === "running" && m.opMode === name, 15_000, from);
    }
    return from;
  };
  const stopFromApp = async (name, ms = 5000) => {
    const from = app.log.length;
    const sent = performance.now();
    app.send({ type: "stop" });
    await app.next((m) => m.type === "lifecycle" && m.phase === "stopped" && m.opMode === name, ms, from);
    return (performance.now() - sent) / 1000;
  };
  const latestState = (from) => [...app.log.slice(from)].reverse().find((m) => m.type === "state" && m.pose);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  await attempt("TeleOp drives from the Driver Station gamepad and the app follows it", async () => {
    const from = await begin("Example TeleOp");
    const before = (await app.next((m) => m.type === "state" && m.pose, 10_000, from)).pose;
    dsSend({ type: "gamepad", index: 1, state: { left_stick_y: -1 } });
    await sleep(1200);
    dsSend({ type: "gamepad", index: 1, state: {} });
    await sleep(1200);
    const released = latestState(from).pose;
    await sleep(600);
    const settled = latestState(from).pose;
    const driven = distance(before, released);
    expect(driven > 10, `moved ${driven.toFixed(1)} in with the stick pushed`);
    expect(distance(released, settled) < 1, `still moving ${distance(released, settled).toFixed(2)} in after release`);
    return `moved ${driven.toFixed(1)} in, then held still`;
  });
  await attempt("Session.data values reach the app, and gamepad A switches the drive mode", async () => {
    const from = app.log.length;
    const first = await app.next((m) => m.type === "state" && m.data?.drive, 5000, from);
    dsSend({ type: "gamepad", index: 1, state: { a: true } });
    await sleep(300);
    dsSend({ type: "gamepad", index: 1, state: {} });
    const toggled = await app.next((m) => m.type === "state" && m.data?.drive && m.data.drive !== first.data.drive, 5000, from);
    await stopFromApp("Example TeleOp");
    return `drive: ${first.data.drive} → ${toggled.data.drive}`;
  });
  await attempt("An OpMode that throws in loop() is stopped, and the robot stream reports it", async () => {
    const from = await begin("Fault: Throws In Loop");
    await app.next((m) => m.type === "lifecycle" && m.phase === "stopped", 6000, from);
    const error = await dsNext((m) => m.type === "error" && /intake jammed/.test(m.message), 5000);
    return `Driver Station error: ${error.message}`;
  });
  await attempt("An OpMode that throws in init() stops without running", async () => {
    const from = await begin("Fault: Throws In Init", { start: false });
    await app.next((m) => m.type === "lifecycle" && m.phase === "stopped", 6000, from);
    expect(!app.log.slice(from).some((m) => m.type === "lifecycle" && m.phase === "running"), "it reached running");
    const error = await dsNext((m) => m.type === "error" && /arm encoder missing/.test(m.message), 5000);
    return `Driver Station error: ${error.message}`;
  });
  await attempt("A LinearOpMode reports through Session and stops promptly on STOP", async () => {
    const from = await begin("Fault: Linear Counter");
    const a = await app.next((m) => m.type === "state" && typeof m.data?.count === "number", 5000, from);
    await sleep(500);
    const later = [...app.log.slice(from)].reverse().find((m) => m.type === "state" && typeof m.data?.count === "number");
    expect(later.data.count > a.data.count, `count did not advance (${a.data.count} → ${later.data.count})`);
    const seconds = await stopFromApp("Fault: Linear Counter", 3000);
    return `count ${a.data.count} → ${later.data.count}; stopped ${seconds.toFixed(2)} s after STOP`;
  });
  await attempt("Awkward Session.data values still reach the app as valid JSON", async () => {
    const from = await begin("Fault: Odd Data");
    await sleep(1000);
    const bad = app.log.slice(from).filter((m) => m.type === "__unparseable");
    const states = app.log.slice(from).filter((m) => m.type === "state" && m.data && "text" in m.data);
    const state = states[0];
    await stopFromApp("Fault: Odd Data");
    expect(bad.length === 0, `${bad.length} messages were not valid JSON, for example ${bad[0]?.raw.slice(0, 160)}`);
    expect(state, "no state message with the data arrived");
    const shown = Object.entries(state.data).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(", ");
    expect(state.data.text === "quote \" backslash \\ newline \n tab \t accent é check ✓", `text came back as ${JSON.stringify(state.data.text)}`);
    expect(JSON.stringify(state.data.array) === "[1,2,3]", `int[] came back as ${JSON.stringify(state.data.array)}`);
    expect(JSON.stringify(state.data.keyed) === '{"1":"one"}', `a map with integer keys came back as ${JSON.stringify(state.data.keyed)}`);
    // A value the writer cannot handle disables the Session for the rest of the run, so reports would stop.
    expect(states.length >= 5, `only ${states.length} reports arrived in a second`);
    return `${states.length} reports in 1 s; ${shown}`;
  });
  await attempt("An OpMode that ignores STOP is still stopped", async () => {
    await begin("Fault: Ignores Stop");
    await sleep(300);
    const seconds = await stopFromApp("Fault: Ignores Stop", 8000);
    const error = await dsNext((m) => m.type === "error" && /stop/i.test(m.message), 5000).catch(() => null);
    return `stopped ${seconds.toFixed(2)} s after STOP${error ? `; Driver Station: ${error.message}` : ""}`;
  });
  await attempt("Two apps see the same run, and either one can stop it", async () => {
    const second = await appClient(ports.robot);
    await second.next((m) => m.type === "manifest");
    const from2 = second.log.length;
    const from = await begin("Example Auto");
    await second.next((m) => m.type === "lifecycle" && m.phase === "running", 10_000, from2);
    await second.next((m) => m.type === "state" && m.pose, 10_000, from2);
    await app.next((m) => m.type === "state" && m.pose, 10_000, from);
    const at = second.log.length;
    second.send({ type: "stop" });
    await second.next((m) => m.type === "lifecycle" && m.phase === "stopped", 5000, at);
    await app.next((m) => m.type === "lifecycle" && m.phase === "stopped", 5000, from);
    second.close();
  });
  await attempt("After the faults, Example Auto still parks at (36, 24)", async () => {
    dsSend({ type: "place", x: 9, y: 72, heading: 0 });
    const from = await begin("Example Auto");
    await sleep(9000);
    const pose = latestState(from).pose;
    await stopFromApp("Example Auto");
    expect(Math.abs(pose.x - 36) < 2 && Math.abs(pose.y - 24) < 2, `parked at (${pose.x}, ${pose.y})`);
    return `parked at (${pose.x.toFixed(2)}, ${pose.y.toFixed(2)}), ${(pose.heading * 180 / Math.PI).toFixed(1)}°`;
  });
  await attempt("Robot restart: the stream comes back on port 58080 with the OpModes and hardware", async () => {
    const closed = app.closed;
    dsSend({ type: "restart" });
    await Promise.race([closed, sleep(5000).then(() => { throw new Error("the old connection was not closed"); })]);
    const sent = performance.now();
    let again = null;
    while (!again && performance.now() - sent < 10_000) {
      again = await appClient(ports.robot).catch(() => null);
      if (!again) await sleep(250);
    }
    expect(again, "could not reconnect within 10 s");
    const manifest = await again.next((m) => m.type === "manifest" && m.opModes.length > 0, 10_000);
    expect(manifest.devices.length > 0, "no devices after the restart");
    const from = again.log.length;
    dsSend({ type: "init", opMode: "Example TeleOp" });
    await again.next((m) => m.type === "lifecycle" && m.phase === "init", 10_000, from);
    again.send({ type: "stop" });
    await again.next((m) => m.type === "lifecycle" && m.phase === "stopped", 5000, from);
    again.close();
    return `reconnected after ${((performance.now() - sent) / 1000).toFixed(2)} s; ${manifest.opModes.length} OpModes, ${manifest.devices.length} devices; INIT and STOP work`;
  });
  await attempt("Only the deliberate faults reported errors", async () => {
    const unexpected = dsState.errors.filter((e) => !/^Fault: /.test(e.opMode ?? ""));
    expect(unexpected.length === 0, unexpected.map((e) => `${e.opMode}: ${e.message}`).join("; "));
    return `${dsState.errors.length} errors, all from fault OpModes`;
  });

  app.close();
  return finish();
}

// ---------------------------------------------------------------------------------------------
// Helpers.

function appClient(port) {
  return new Promise((done, failOpen) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/stream`);
    const log = [];
    let listeners = [];
    const pinger = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping", t: Date.now() })); }, 2000);
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        // Kept so checks can see it: the app's own parser would drop such a frame silently.
        message = { type: "__unparseable", raw: String(event.data) };
      }
      log.push(message);
      listeners.forEach((listener) => listener(message));
    });
    let markClosed;
    const closed = new Promise((resolveClosed) => { markClosed = resolveClosed; });
    socket.addEventListener("close", () => { clearInterval(pinger); markClosed(); });
    socket.addEventListener("error", () => failOpen(new Error("Could not connect to the robot stream.")), { once: true });
    socket.addEventListener("open", () => done({
      log,
      closed,
      send: (message) => socket.send(JSON.stringify(message)),
      next: (match, ms = 15_000, from = 0) => waitFor(log, (listener) => { listeners.push(listener); return () => { listeners = listeners.filter((l) => l !== listener); }; }, match, ms, from),
      close: () => { clearInterval(pinger); socket.close(); },
    }), { once: true });
  });
}

/** Opens a client that never sends anything; resolves with the seconds until the server closed it. */
function idleClient(port) {
  return new Promise((done, failOpen) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/stream`);
    let opened = 0;
    socket.addEventListener("open", () => { opened = performance.now(); });
    socket.addEventListener("close", () => done((performance.now() - opened) / 1000));
    socket.addEventListener("error", () => { if (!opened) failOpen(new Error("Could not connect.")); });
    setTimeout(() => { failOpen(new Error("still open after 20 s")); socket.close(); }, 20_000);
  });
}

/** The HTTP status of a WebSocket upgrade request sent with the given Origin header. */
function upgradeStatus(port, origin) {
  return new Promise((done, failRequest) => {
    const req = request({
      host: "127.0.0.1", port, path: "/stream",
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": randomBytes(16).toString("base64"), Origin: origin },
    });
    req.on("upgrade", (response, socket) => { socket.destroy(); done(response.statusCode); });
    req.on("response", (response) => { response.resume(); done(response.statusCode); });
    req.on("error", failRequest);
    req.end();
  });
}

function waitFor(log, subscribe, match, ms, from = 0) {
  return new Promise((done, failWait) => {
    const found = log.slice(from).find(match);
    if (found) return done(found);
    let unsubscribe = () => {};
    const timer = setTimeout(() => { unsubscribe(); failWait(new Error("timed out waiting for a message")); }, ms);
    unsubscribe = subscribe((message) => { if (match(message)) { clearTimeout(timer); unsubscribe(); done(message); } });
  });
}

/** Points Gradle at an Android SDK when the project has no local.properties and none is configured. */
function androidSdkEnvironment() {
  if (process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || existsSync(resolve(project, "local.properties"))) return {};
  const fromRobot = resolve(repo, "robot/local.properties");
  if (existsSync(fromRobot)) {
    const match = /^sdk\.dir=(.*)$/m.exec(readFileSync(fromRobot, "utf8"));
    if (match) return { ANDROID_HOME: match[1].trim().replace(/\\:/g, ":").replace(/\\\\/g, "\\") };
  }
  const home = process.env.LOCALAPPDATA ?? process.env.HOME ?? "";
  const candidates = [resolve(home, "Android/Sdk"), resolve(home, "Library/Android/sdk"), resolve(home, "Android/Sdk")];
  const found = candidates.find((path) => existsSync(path));
  return found ? { ANDROID_HOME: found } : {};
}

function expect(condition, message) { if (!condition) throw new Error(message); }
function sleep(ms) { return new Promise((done) => setTimeout(done, ms)); }
function say(text) { console.log(text); }
function fail(message) { console.error(message); process.exit(1); }
function readUsage() {
  return [
    "Virtual REV Control Hub (development only)",
    "  node dev/virtual-hardware/virtual-hub.mjs [--project <dir>] [--create]   interactive Driver Station",
    "  node dev/virtual-hardware/virtual-hub.mjs --check                          robot-stream contract checks",
    "  node dev/virtual-hardware/virtual-hub.mjs --shakedown                      driving, faulty OpModes, restart",
    '  node dev/virtual-hardware/virtual-hub.mjs --run "Example Auto" [--seconds 12]',
    '  node dev/virtual-hardware/virtual-hub.mjs --script "until app; init Example Auto; start; wait 20; stop"',
    "  node dev/virtual-hardware/virtual-hub.mjs --probe [--pedro 3.0.2]          Pedro heading probe",
    "Options: --config <simulator.json>  --pedro <version>  --offline",
  ].join("\n");
}
