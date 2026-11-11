// @vitest-environment node
import { describe, expect, it } from "vitest";
import direct from "../../../../fixtures/projects/direct-devices.json";
import sample from "../../../../fixtures/projects/sample-robot.json";
import { generateJava } from "../codegen/java/generate";
import { javaNumber } from "../codegen/java/names";
import { parseProject } from "../ir/schema";
import type { AutonomousProgram, Project } from "../ir/types";
import { isPairingHash, newPairingSecret, pairingHash } from "./pairing";
import { buildLiveProgram, LIVE_FORMAT, readLiveReport } from "./program";

const project = (): Project => parseProject(structuredClone(sample));
const firstAuto = (value: Project) => value.programs.find((program): program is AutonomousProgram => program.kind === "autonomous")!;

describe("buildLiveProgram", () => {
  it("sends the poses, heading rules and routine the generated Java uses", () => {
    const value = project();
    const auto = firstAuto(value);
    const live = buildLiveProgram(value, auto);
    expect(live.format).toBe(LIVE_FORMAT);
    expect(live.name).toBe(auto.name.trim());
    expect(live.start).toEqual({ x: auto.start.x, y: auto.start.y, headingDeg: auto.start.headingDeg });
    expect(live.paths.map((path) => path.id)).toEqual(auto.paths.map((path) => path.id));

    // Each path starts where the previous one ended, and its poses are the ones the generated OpMode declares.
    const generated = generateJava(value);
    if (!generated.ok) throw new Error("the sample should generate");
    const java = generated.files.map((file) => file.content).join("\n");
    let previous = live.start;
    for (const path of live.paths) {
      expect(path.segments[0].start).toEqual(previous);
      for (const segment of path.segments) {
        // The same numbers, written the way the generator writes them, so the robot parses the same doubles.
        const pose = `poses.of(${javaNumber(segment.end.x)}, ${javaNumber(segment.end.y)}, ${javaNumber(segment.end.headingDeg)})`;
        expect(java, pose).toContain(pose);
        expect(Number(javaNumber(segment.end.headingDeg))).toBe(segment.end.headingDeg);
      }
      previous = path.segments[path.segments.length - 1].end;
    }
  });

  it("keeps compound paths' own heading rule, leaves out empty groups and unused mechanisms", () => {
    const value = project();
    const auto = firstAuto(value);
    const start = auto.paths[0];
    if (start.kind !== "atomic") throw new Error("the sample's first path is atomic");
    auto.paths = [{
      id: "chain", name: "Chain", color: "#fff", kind: "compound", heading: { type: "constant", degrees: 90 },
      segments: [start, { ...start, id: "second", end: { x: start.end.x + 10, y: start.end.y }, controlPoints: [{ x: start.end.x + 5, y: start.end.y + 5 }] }],
    }];
    auto.routine = [{ id: "g", kind: "together", steps: [] }, { id: "p", kind: "path", pathId: "chain" }, { id: "w", kind: "wait", ms: 250 }];
    value.subsystems = value.subsystems.map((subsystem) => ({ ...subsystem, initialStateId: null }));
    const live = buildLiveProgram(value, auto);
    expect(live.paths[0].kind).toBe("compound");
    expect(live.paths[0].heading).toEqual({ type: "constant", degrees: 90 });
    expect(live.paths[0].segments.map((segment) => segment.heading)).toEqual([null, null]);
    expect(live.paths[0].segments[1].start).toEqual(live.paths[0].segments[0].end);
    expect(live.paths[0].segments[1].controls).toEqual([{ x: start.end.x + 5, y: start.end.y + 5 }]);
    expect(live.routine).toEqual([{ kind: "path", path: "chain" }, { kind: "wait", ms: 250 }]);
    expect(live.mechanisms).toEqual([]);
  });

  it("lists each device once with its settings, and sends device actions and durations", () => {
    const value = parseProject(structuredClone(direct));
    const live = buildLiveProgram(value, firstAuto(value));
    expect(live.format).toBe(2);
    // The mechanism's device first, then the routine's own; settings once each, and limits only below 1.
    expect(live.devices).toEqual([
      { name: "roller", kind: "crservo", reversed: false, powerLimit: 0.6 },
      { name: "intake", kind: "motor", reversed: false, powerLimit: 0.7 },
      { name: "lift", kind: "motor", reversed: true, powerLimit: 0.8, travel: { minTicks: -100, maxTicks: 1500 } },
      { name: "kicker", kind: "servo", reversed: true },
      { name: "spinner", kind: "crservo", reversed: true, powerLimit: 0.5 },
    ]);
    expect(live.mechanisms[0].devices).toEqual([{ id: "device_roller", name: "roller", kind: "crservo" }]);
    // Powers are sent as the project has them; the robot cuts each to its device's limit, as the generated Java does.
    expect(live.routine[0]).toEqual({ kind: "together", steps: [
      { kind: "path", path: "path_out" },
      { kind: "device", device: "intake", output: { kind: "power", value: 0.9 } },
      { kind: "state", mechanism: "mech_roller", state: "state_roller_spin", duration: { ms: 1500, then: "state_roller_stop" } },
    ] });
    expect(live.routine.slice(1, 4)).toEqual([
      { kind: "device", device: "lift", output: { kind: "target", ticks: 1200, power: 1 } },
      { kind: "device", device: "kicker", output: { kind: "position", value: 0.6 }, duration: { ms: 500, thenPosition: 0.2 } },
      { kind: "device", device: "spinner", output: { kind: "power", value: 1 }, duration: { ms: 500 } },
    ]);
  });

  it("gives the same program the same revision, and a changed one a new revision", () => {
    const value = project();
    const auto = firstAuto(value);
    const first = buildLiveProgram(value, auto);
    expect(buildLiveProgram(project(), firstAuto(project())).revision).toBe(first.revision);
    auto.start = { ...auto.start, x: auto.start.x + 1 };
    expect(buildLiveProgram(value, auto).revision).not.toBe(first.revision);
  });
});

describe("readLiveReport", () => {
  it("keeps well-formed fields and drops the rest", () => {
    expect(readLiveReport({ state: "accepted", paired: true, started: false, dryRun: true, powerCap: 0.6,
      program: { name: "Red", revision: "abc", steps: 3, paths: 2, mechanisms: 1 }, problems: [], notes: ["capped", 7] }))
      .toEqual({ opMode: "Lumière Live", state: "accepted", started: false, paired: true, dryRun: true, powerCap: 0.6, silenceMs: 1000,
        program: { name: "Red", revision: "abc", steps: 3, paths: 2, mechanisms: 1 }, problems: [], notes: ["capped"] });
    expect(readLiveReport({ state: "dancing" })).toBeNull();
    // After START: the run, with its phase, reason and time.
    expect(readLiveReport({ state: "accepted", dryRun: false, silenceMs: 1000, run: { phase: "stopped", reason: "the paired computer was silent for more than 1 s.", elapsedMs: -1 } })?.run)
      .toEqual({ phase: "stopped", reason: "the paired computer was silent for more than 1 s." });
    expect(readLiveReport({ state: "accepted", run: { phase: "finished", reason: null, elapsedMs: 23560 } })?.run).toEqual({ phase: "finished", reason: null, elapsedMs: 23560 });
    expect(readLiveReport({ state: "accepted", run: { phase: "flying" } })?.run).toBeUndefined();
    expect(readLiveReport(null)).toBeNull();
  });
});

describe("pairing", () => {
  it("hashes secrets with SHA-256 and makes fresh 64-digit secrets", async () => {
    expect(await pairingHash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const secret = newPairingSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(newPairingSecret()).not.toBe(secret);
    expect(isPairingHash(await pairingHash(secret))).toBe(true);
    expect(isPairingHash("ABC")).toBe(false);
  });
});
