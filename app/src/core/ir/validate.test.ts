import { describe, expect, it } from "vitest";
import sample from "../../../../fixtures/projects/sample-robot.json";
import { createAutonomous, createLine, createProject, createTeleOp } from "./create";
import { parseProject, safeParseProject } from "./schema";
import type { AutonomousProgram, Project, TeleOpProgram } from "./types";
import { validateProject } from "./validate";

const codes = (project: Project) => validateProject(project).map((item) => `${item.severity}:${item.code}`);
const load = () => parseProject(structuredClone(sample));

describe("project schema", () => {
  it("accepts the sample project and rejects malformed ones", () => {
    expect(() => load()).not.toThrow();
    const bad = structuredClone(sample) as Record<string, unknown>;
    bad.version = 1;
    expect(safeParseProject(bad).ok).toBe(false);
    const servo = structuredClone(sample);
    (servo.subsystems[0].states[0].outputs as Record<string, { value: number }>).device_claw.value = 3;
    const result = safeParseProject(servo);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("subsystems.0.states.0.outputs.device_claw.value");
  });

  it("creates valid empty projects and programs", () => {
    const project = createProject("New Robot");
    project.programs.push(createAutonomous("Auto"), createTeleOp("TeleOp"));
    expect(() => parseProject(project)).not.toThrow();
    expect(codes(project)).toEqual([]);
  });
});

describe("validateProject", () => {
  it("finds no errors in the sample project", () => {
    expect(validateProject(load()).filter((item) => item.severity === "error")).toEqual([]);
  });

  it("reports duplicate and reserved OpMode names", () => {
    const project = load();
    project.programs[1].name = "blue basket";
    expect(codes(project)).toContain("error:program.name.duplicate");
    project.programs[1].name = "Example Auto";
    expect(codes(project)).toContain("warning:program.name.reserved");
  });

  it("reports geometry problems", () => {
    const project = load();
    const auto = project.programs[0] as AutonomousProgram;
    auto.paths[0] = { ...auto.paths[0], kind: "atomic", end: { x: auto.start.x, y: auto.start.y }, controlPoints: [] } as AutonomousProgram["paths"][number];
    auto.start.x = -5;
    const found = codes(project);
    expect(found).toContain("error:auto.start.field");
    const zero = load();
    const zeroAuto = zero.programs[0] as AutonomousProgram;
    zeroAuto.paths.unshift({ ...createLine({ x: zeroAuto.start.x, y: zeroAuto.start.y }, 0, 0), id: "zero" });
    expect(codes(zero)).toContain("error:path.length.zero");
  });

  it("reports routine mistakes", () => {
    const project = load();
    const auto = project.programs[0] as AutonomousProgram;
    auto.routine.push({ id: "extra", kind: "together", steps: [
      { id: "a", kind: "path", pathId: "path_score" },
      { id: "b", kind: "path", pathId: "path_park" },
    ] });
    auto.routine.push({ id: "missing", kind: "state", subsystemId: "mech_claw", stateId: "gone" });
    auto.routine.push({ id: "long", kind: "wait", ms: 40_000 });
    const found = codes(project);
    expect(found).toContain("error:step.group.paths");
    expect(found).toContain("error:step.state.missing");
    expect(found).toContain("warning:step.wait.long");
    expect(found).toContain("warning:routine.path.order");
  });

  it("reports unused paths and missing preselected TeleOps as info", () => {
    const project = load();
    const auto = project.programs[0] as AutonomousProgram;
    auto.routine = auto.routine.filter((step) => step.id !== "step_9");
    auto.preselectTeleOp = "Nope";
    const found = codes(project);
    expect(found).toContain("info:path.unused");
    expect(found).toContain("info:auto.preselect");
  });

  it("reports mechanism problems", () => {
    const project = load();
    project.subsystems[1].devices.push({ id: "dup", name: "claw", kind: "motor", reversed: false });
    project.subsystems[0].states[0].outputs.device_claw = { kind: "power", value: 1 };
    project.subsystems[2].initialStateId = "missing";
    const found = codes(project);
    expect(found).toContain("error:device.shared");
    expect(found).toContain("error:state.output.kind");
    expect(found).toContain("error:subsystem.initialState");
  });

  it("reports gamepad conflicts", () => {
    const project = load();
    const teleop = project.programs[1] as TeleOpProgram;
    teleop.bindings.push({ id: "clash", gamepad: 2, button: "a", action: { kind: "state", subsystemId: "mech_claw", stateId: "state_claw_open" } });
    teleop.bindings.push({ id: "slow", gamepad: 1, button: "right_bumper", action: { kind: "state", subsystemId: "mech_claw", stateId: "state_claw_open" } });
    const found = validateProject(project).filter((item) => item.code === "binding.button.duplicate");
    expect(found).toHaveLength(2);
    expect(found[1].message).toContain("slow mode");
  });
});
