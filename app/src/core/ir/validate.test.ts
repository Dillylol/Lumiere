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
    project.programs[1].name = "Lumière Live";
    expect(codes(project)).toContain("error:program.name.live");
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

describe("robot profile checks", () => {
  const scanned = (project: Project) => validateProject(project).filter((item) => item.code.startsWith("robot."));
  const drivetrain = {
    frontLeft: { name: "left_front_drive", reversed: true },
    frontRight: { name: "right_front_drive", reversed: false },
    backLeft: { name: "left_back_drive", reversed: true },
    backRight: { name: "right_back_drive", reversed: false },
  };

  it("warns when the robot is larger than the starting sizing cube", () => {
    const project = createProject("Big");
    project.robot.widthInches = 19;
    expect(scanned(project).map((item) => [item.code, item.location])).toEqual([["robot.size.cube", { robot: true }]]);
  });

  it("notes untuned and unreadable Pedro constants", () => {
    const project = createProject("Untuned");
    project.robot.constants = { file: "TeamCode/x/pedro/Constants.java", readAt: "2026-11-07T10:00:00Z", tuned: false, unreadable: ["ForesightConfig.naturalForwardDeceleration"] };
    const codes = scanned(project).map((item) => `${item.severity}:${item.code}`);
    expect(codes).toEqual(["info:robot.constants.untuned", "info:robot.constants.unreadable"]);
  });

  it("checks drive motors, the localizer and mechanism devices against the robot's configuration", () => {
    const project = createProject("Scanned");
    project.robot.drivetrain = drivetrain;
    project.robot.localizer = { kind: "pinpoint", name: "pinpoint" };
    const claw = { id: "claw", name: "Claw", devices: [
      { id: "servo", name: "claw", kind: "servo" as const, reversed: false },
      { id: "lift", name: "lift", kind: "motor" as const, reversed: false },
    ], states: [], initialStateId: null };
    project.subsystems.push(claw);
    project.robot.scan = { scannedAt: "2026-11-07T10:00:00Z", devices: [
      { name: "left_front_drive", type: "motor" }, { name: "right_front_drive", type: "motor" },
      { name: "left_back_drive", type: "motor" }, { name: "right_back_drive", type: "servo" },
      { name: "claw", type: "motor" },
    ] };
    expect(scanned(project).map((item) => item.code)).toEqual([
      "robot.drive.type", "robot.localizer.missing", "robot.device.type", "robot.device.missing",
    ]);
    expect(scanned(project).find((item) => item.code === "robot.device.missing")?.location).toEqual({ subsystemId: "claw", deviceId: "lift" });
  });

  it("keeps mechanisms off Pedro's dead wheels, and checks every localizer device against the robot", () => {
    const project = createProject("Dead wheels");
    project.robot.drivetrain = drivetrain;
    project.robot.localizer = { kind: "threewheelimu", devices: [
      { role: "leftEncoder", name: "intake" }, { role: "rightEncoder", name: "lift" }, { role: "strafeEncoder", name: "turret" },
    ] };
    // A motor sharing its port with a dead wheel may be given power, but not an encoder target.
    const motor = (id: string, name: string) => ({ id, name, kind: "motor" as const, reversed: false });
    project.subsystems.push(
      { id: "intake", name: "Intake", devices: [motor("i", "intake")], states: [{ id: "on", name: "On", outputs: { i: { kind: "power", value: 1 } } }], initialStateId: null },
      { id: "turret", name: "Turret", devices: [motor("t", "turret")], states: [{ id: "c", name: "Center", outputs: { t: { kind: "target", ticks: 0, power: 0.5 } } }], initialStateId: null },
    );
    const unscanned = scanned(project);
    expect(unscanned.map((item) => `${item.severity}:${item.code}`)).toEqual(["error:robot.device.odometry"]);
    expect(unscanned[0].location).toEqual({ subsystemId: "turret", deviceId: "t" });
    expect(unscanned[0].message).toContain("strafe dead wheel");

    // The robot reports Pedro's IMU, which the constants file left to Pedro's default, and a different right wheel.
    project.robot.scan = { scannedAt: "2026-11-10T10:00:00Z", devices: [
      ...Object.values(drivetrain).map((item) => ({ name: item.name, type: "motor" })),
      { name: "intake", type: "motor" }, { name: "turret", type: "motor" }, { name: "lift", type: "servo" }, { name: "imu", type: "voltage" },
    ], pedro: { constants: "org.firstinspires.ftc.teamcode.pedro.Constants", localizer: "threewheelimu", devices: [
      { role: "rightEncoder", name: "lift2" }, { role: "imu", name: "imu" },
    ] } };
    const found = scanned(project);
    expect(found.map((item) => item.code)).toEqual(["robot.device.odometry", "robot.localizer.type", "robot.localizer.type", "robot.pedro.mismatch"]);
    expect(found[1].message).toBe(`"lift" is configured as servo, but Pedro Pathing uses it as its right dead wheel, which needs a motor port.`);
    expect(found[2].message).toContain("localizer IMU, which needs imu");
    expect(found[3].message).toContain(`name "lift" as the right dead wheel, but the robot reports "lift2"`);
  });

  it("uses the robot's report for Pedro devices when the project has not read the constants", () => {
    const project = createProject("Browser");
    project.subsystems.push({ id: "m", name: "Lift", devices: [{ id: "d", name: "lf", kind: "motor", reversed: false }], states: [], initialStateId: null });
    project.robot.scan = { scannedAt: "2026-11-10T10:00:00Z", devices: [{ name: "lf", type: "motor" }], pedro: {
      constants: "org.firstinspires.ftc.teamcode.pedro.Constants", localizer: "pinpoint",
      devices: [{ role: "frontLeft", name: "lf" }, { role: "pinpoint", name: "odo" }],
    } };
    expect(scanned(project).map((item) => `${item.severity}:${item.code}`)).toEqual(["error:robot.device.drive", "warning:robot.localizer.missing"]);
  });

  it("matches names the way the robot does, ignoring spaces at either end", () => {
    const project = createProject("Spaces");
    project.subsystems.push({ id: "c", name: "Claw", devices: [{ id: "s", name: " claw ", kind: "servo", reversed: false }], states: [], initialStateId: null });
    project.robot.scan = { scannedAt: "2026-11-10T10:00:00Z", devices: [{ name: "claw", type: "servo" }] };
    const codes = validateProject(project).map((item) => item.code);
    expect(codes).toContain("device.name.spaces");
    expect(codes).not.toContain("robot.device.missing");
  });

  it("skips hardware checks until the robot has been scanned, but still catches a device used twice", () => {
    const project = createProject("Unscanned");
    project.robot.drivetrain = drivetrain;
    project.subsystems.push({ id: "intake", name: "Intake", devices: [{ id: "d", name: "left_front_drive", kind: "motor", reversed: false }], states: [], initialStateId: null });
    expect(scanned(project).map((item) => item.code)).toEqual(["robot.device.drive"]);
  });
});
