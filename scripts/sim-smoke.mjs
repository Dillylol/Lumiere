// End-to-end check of the interactive simulator in a generated robot project, driven the way the
// desktop app drives it: launch through Gradle, connect over WebSocket, run an OpMode, and shut down.
//
// Usage: node scripts/sim-smoke.mjs --project <robot project> [--opmode "Example Auto"] [--seconds 12]
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const value = (flag, fallback) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : fallback; };
const project = value("--project");
const opMode = value("--opmode", "Example Auto");
const seconds = Number(value("--seconds", "12"));
if (!project) {
  console.error('Usage: node scripts/sim-smoke.mjs --project <robot project> [--opmode "Example Auto"] [--seconds 12]');
  process.exit(2);
}

const token = randomBytes(24).toString("hex");
const windows = process.platform === "win32";
const gradleArgs = [
  ":TeamCode:testDebugUnitTest", "--tests", "org.firstinspires.ftc.teamcode.simulation.RunSimulator",
  // Port 0: the simulator binds a free port and reports it, as the desktop app requests.
  "-Psim.port=0", "--console=plain",
];
const cwd = resolve(project);
// Batch files must run through cmd.exe; the arguments contain no shell metacharacters.
const gradle = windows
  ? spawn("cmd.exe", ["/d", "/c", resolve(cwd, "gradlew.bat"), ...gradleArgs], { cwd, env: { ...process.env, SIM_TOKEN: token } })
  : spawn(resolve(cwd, "gradlew"), gradleArgs, { cwd, env: { ...process.env, SIM_TOKEN: token } });

let output = "";
const port = await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error(`Simulator did not start.\n${output.slice(-4000)}`)), 300_000);
  const onData = (chunk) => {
    output += chunk;
    const match = /SIMULATOR_READY (\d+)/.exec(output);
    if (match) { clearTimeout(timer); done(Number(match[1])); }
  };
  gradle.stdout.on("data", onData);
  gradle.stderr.on("data", onData);
  gradle.on("exit", (code) => { clearTimeout(timer); fail(new Error(`Gradle exited with ${code} before the simulator started.\n${output.slice(-4000)}`)); });
});
console.log(`simulator ready on port ${port}`);

const socket = new WebSocket(`ws://127.0.0.1:${port}/stream`);
const received = [];
const waiters = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  received.push(message);
  for (const waiter of [...waiters]) if (waiter.match(message)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.done(message); }
});
const next = (match, ms = 30_000) => new Promise((done, fail) => {
  const found = received.find(match);
  if (found) return done(found);
  const timer = setTimeout(() => fail(new Error("Timed out waiting for a message")), ms);
  waiters.push({ match, done: (message) => { clearTimeout(timer); done(message); } });
});
await new Promise((done) => socket.addEventListener("open", done, { once: true }));
socket.send(JSON.stringify({ type: "auth", token }));
const pinger = setInterval(() => socket.send(JSON.stringify({ type: "ping", t: Date.now() })), 2000);

const hello = await next((m) => m.type === "hello");
const manifest = await next((m) => m.type === "manifest");
console.log(`hello: source=${hello.source} drivetrain=${JSON.stringify(hello.drivetrain)}`);
console.log(`opModes: ${manifest.opModes.map((entry) => entry.name).join(", ")}`);

socket.send(JSON.stringify({ type: "init", opMode }));
await next((m) => m.type === "lifecycle" && m.phase === "init");
socket.send(JSON.stringify({ type: "start" }));
await next((m) => m.type === "lifecycle" && m.phase === "running");
const path = await next((m) => m.type === "path");
console.log(`path with ${path.points.length} points`);
await new Promise((done) => setTimeout(done, seconds * 1000));
const robot = [...received].reverse().find((m) => m.type === "robot");
const telemetry = [...received].reverse().find((m) => m.type === "telemetry");
const errors = received.filter((m) => m.type === "error");
console.log(`robot after ${seconds}s: ${JSON.stringify(robot?.pose)} phase=${robot?.phase}`);
console.log(`telemetry: ${JSON.stringify(telemetry?.lines)}`);
socket.send(JSON.stringify({ type: "stop" }));
await next((m) => m.type === "lifecycle" && m.phase === "stopped");
socket.send(JSON.stringify({ type: "shutdown" }));
clearInterval(pinger);

const exitCode = await new Promise((done) => gradle.on("exit", done));
socket.close();
if (errors.length) {
  console.error(`Errors reported: ${JSON.stringify(errors)}`);
  process.exit(1);
}
if (!robot || !robot.pose) {
  console.error("No robot state was received.");
  process.exit(1);
}
console.log(`Gradle exited with ${exitCode}`);
process.exit(exitCode === 0 ? 0 : 1);
