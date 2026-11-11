import { describe, expect, it } from "vitest";
import sample from "../../../../fixtures/projects/sample-robot.json";
import { createAutonomous, createLine, createProject, createTeleOp } from "./create";
import { describeProjectError, parseProject, safeParseProject } from "./schema";
import type { AutonomousProgram, DeviceStep, Project, TeleOpProgram } from "./types";
import { actionNumber, describeLocation, validateProject } from "./validate";

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
    if (!result.ok) expect(result.error).toBe('Mechanism "Claw", state "Open": the value is above 1.');
  });

  it("explains a broken project in words, naming the program and action", () => {
    const broken = structuredClone(sample) as unknown as { programs: { routine: Record<string, unknown>[] }[] };
    delete broken.programs[0].routine[1].stateId;
    (broken.programs[0].routine[5].steps as Record<string, unknown>[])[1].subsystemId = 7;
    let message = "";
    try { parseProject(broken); } catch (error) { message = describeProjectError(error, broken); }
    expect(message.split("\n")).toEqual([
      '"Blue Basket", action 2: the state is missing or not valid.',
      '"Blue Basket", action 6.2: the mechanism is missing or not valid.',
    ]);
    expect(describeProjectError(new Error("disk full"))).toBe("disk full");
  });

  it("saves actions and buttons whose mechanism, state or path is not chosen yet", () => {
    const project = load();
    const auto = project.programs[0] as AutonomousProgram;
    auto.routine.push({ id: "unset_state", kind: "state", subsystemId: "", stateId: "" }, { id: "unset_path", kind: "path", pathId: "" });
    const teleop = project.programs[1] as TeleOpProgram;
    teleop.bindings[0].action = { kind: "toggle", subsystemId: "mech_claw", firstStateId: "", secondStateId: "" };
    expect(() => parseProject(project)).not.toThrow();
    const found = validateProject(project);
    const unset = found.filter((item) => item.code.endsWith(".unset"));
    expect(unset.map((item) => [item.severity, item.message])).toEqual([
      ["error", "Choose a mechanism and a state for this action."],
      ["error", "Choose a path for this action."],
      ["error", 'Choose the states of "Claw" for this button.'],
    ]);
    expect(found.some((item) => item.code === "binding.state.same")).toBe(false);
    expect(describeLocation(project, unset[0].location)).toBe("Blue Basket · action 10");
    expect(describeLocation(project, unset[2].location)).toBe("Driver Control · button 1");
    expect(actionNumber(auto.routine, "step_6b")).toBe("6.2");
  });

  it("says when a chosen mechanism has no states yet", () => {
    const project = load();
    project.subsystems.push({ id: "mech_new", name: "Shooter", devices: [], states: [], initialStateId: null });
    (project.programs[0] as AutonomousProgram).routine.push({ id: "new", kind: "state", subsystemId: "mech_new", stateId: "" });
    expect(validateProject(project).find((item) => item.location.stepId === "new")?.message)
      .toBe('"Shooter" has no states yet. Add one on the Robot page, or choose another mechanism.');
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
    project.subsystems[1].devices.push({ id: "dup", name: "claw", kind: "motor" });
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
      { id: "servo", name: "claw", kind: "servo" as const },
      { id: "lift", name: "lift", kind: "motor" as const },
    ], states: [], initialStateId: null };
    project.subsystems.push(claw);
    project.robot.scan = { scannedAt: "2026-11-07T10:00:00Z", devices: [
      { name: "left_front_drive", type: "motor" }, { name: "right_front_drive", type: "motor" },
      { name: "left_back_drive", type: "motor" }, { name: "right_back_drive", type: "servo" },
      { name: "claw", type: "motor" },
    ] };
    expect(scanned(project).map((item) => item.code)).toEqual([
      "robot.device.type", "robot.device.missing", "robot.drive.type", "robot.localizer.missing",
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
    const motor = (id: string, name: string) => ({ id, name, kind: "motor" as const });
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
    project.subsystems.push({ id: "m", name: "Lift", devices: [{ id: "d", name: "lf", kind: "motor" }], states: [], initialStateId: null });
    project.robot.scan = { scannedAt: "2026-11-10T10:00:00Z", devices: [{ name: "lf", type: "motor" }], pedro: {
      constants: "org.firstinspires.ftc.teamcode.pedro.Constants", localizer: "pinpoint",
      devices: [{ role: "frontLeft", name: "lf" }, { role: "pinpoint", name: "odo" }],
    } };
    expect(scanned(project).map((item) => `${item.severity}:${item.code}`)).toEqual(["error:robot.device.drive", "warning:robot.localizer.missing"]);
  });

  it("keeps encoder targets within a motor's travel, and travel ranges on motors", () => {
    const project = createProject("Travel");
    const lift = { name: "lift", kind: "motor" as const, reversed: false, travel: { minTicks: 0, maxTicks: 1800 } };
    project.robot.hardware = [lift, { name: "claw", kind: "servo", reversed: false, travel: { minTicks: 0, maxTicks: 10 } }];
    project.subsystems.push({ id: "m", name: "Lift", devices: [{ id: "l", name: "lift", kind: "motor" }, { id: "c", name: "claw", kind: "servo" }], initialStateId: null, states: [
      { id: "up", name: "Up", outputs: { l: { kind: "target", ticks: 2000, power: 0.8 } } },
      { id: "down", name: "Down", outputs: { l: { kind: "target", ticks: 0, power: 0.5 } } },
    ] });
    const found = validateProject(project).filter((item) => item.code === "hardware.travel" || item.code === "state.output.travel");
    expect(found.map((item) => `${item.severity}:${item.code}`)).toEqual(["error:state.output.travel", "error:hardware.travel"]);
    expect(found[0].message).toBe(`"Up" sends "lift" to 2000 ticks, outside its travel of 0 to 1800.`);
    expect(found[1].message).toBe(`"claw" is a servo; only motors have a travel range.`);
    expect(found[1].location).toEqual({ robot: true, hardware: "claw" });
    lift.travel = { minTicks: 100, maxTicks: 100 };
    expect(validateProject(project).some((item) => item.message.includes("from a lower number of ticks to a higher one"))).toBe(true);
  });

  it("matches names the way the robot does, ignoring spaces at either end", () => {
    const project = createProject("Spaces");
    project.subsystems.push({ id: "c", name: "Claw", devices: [{ id: "s", name: " claw ", kind: "servo" }], states: [], initialStateId: null });
    project.robot.scan = { scannedAt: "2026-11-10T10:00:00Z", devices: [{ name: "claw", type: "servo" }] };
    const codes = validateProject(project).map((item) => item.code);
    expect(codes).toContain("device.name.spaces");
    expect(codes).not.toContain("robot.device.missing");
  });

  it("skips hardware checks until the robot has been scanned, but still catches a device used twice", () => {
    const project = createProject("Unscanned");
    project.robot.drivetrain = drivetrain;
    project.subsystems.push({ id: "intake", name: "Intake", devices: [{ id: "d", name: "left_front_drive", kind: "motor" }], states: [], initialStateId: null });
    expect(scanned(project).map((item) => item.code)).toEqual(["robot.device.drive"]);
  });
});

describe("devices set directly, and the hardware list", () => {
  const withRoutine = (...routine: AutonomousProgram["routine"]) => {
    const project = createProject("Direct");
    const auto = createAutonomous("Auto");
    auto.routine = routine;
    project.programs.push(auto);
    return { project, auto };
  };
  const motor = (id: string, device: string, output: DeviceStep["output"]): DeviceStep => ({ id, kind: "device", device, deviceKind: "motor", output });

  it("asks for a device, and an output its kind takes", () => {
    const { project } = withRoutine(
      { id: "a", kind: "device", device: "", deviceKind: "servo", output: { kind: "position", value: 0.5 } },
      { id: "b", kind: "device", device: "spin", deviceKind: "crservo", output: { kind: "position", value: 0.5 } },
    );
    const found = validateProject(project).filter((item) => item.code.startsWith("step.device"));
    expect(found.map((item) => [item.code, item.message])).toEqual([
      ["step.device.unset", "Choose the servo this action sets."],
      ["step.device.output", "A continuous servo can't be given a position."],
    ]);
    expect(describeLocation(project, found[0].location)).toBe("Auto · action 1");
  });

  it("notes when a power limit cuts an action's or a state's power", () => {
    const { project } = withRoutine(motor("a", "intake", { kind: "power", value: -0.9 }), motor("b", "lift", { kind: "target", ticks: 100, power: 0.5 }));
    project.robot.hardware = [{ name: "intake", kind: "motor", reversed: false, powerLimit: 0.7 }, { name: "lift", kind: "motor", reversed: false, powerLimit: 0.6 }];
    project.subsystems.push({ id: "m", name: "Roller", devices: [{ id: "d", name: "intake", kind: "motor" }], initialStateId: null,
      states: [{ id: "s", name: "Out", outputs: { d: { kind: "power", value: 1 } } }] });
    const notes = validateProject(project).filter((item) => item.code === "device.power.limit");
    expect(notes.map((item) => item.message)).toEqual([
      `"Out" gives "intake" power 1. Its power limit is 0.7, so it runs at 0.7.`,
      `This action gives "intake" power -0.9. Its power limit is 0.7, so it runs at -0.7.`,
    ]);
    expect(notes.every((item) => item.severity === "info")).toBe(true);
    // The mechanism also owns the intake, which is fine, but worth saying.
    expect(codes(project)).toContain("info:step.device.mechanism");
  });

  it("keeps an action's encoder target inside the motor's travel", () => {
    const { project } = withRoutine(motor("a", "lift", { kind: "target", ticks: 2000, power: 0.5 }));
    project.robot.hardware = [{ name: "lift", kind: "motor", reversed: false, travel: { minTicks: 0, maxTicks: 1800 } }];
    expect(codes(project)).toContain("error:step.device.travel");
  });

  it("requires every use of a device to agree on what it is", () => {
    const { project } = withRoutine({ id: "a", kind: "device", device: "claw", deviceKind: "crservo", output: { kind: "power", value: 1 } });
    project.robot.hardware = [{ name: "claw", kind: "servo", reversed: false }];
    expect(validateProject(project).find((item) => item.code === "device.kind")?.message)
      .toBe(`"claw" is used as a continuous servo, but the hardware list has it as a servo.`);

    // Without an entry, two uses that disagree are reported too.
    const other = withRoutine(motor("a", "arm", { kind: "power", value: 1 }), { id: "b", kind: "device", device: "arm", deviceKind: "servo", output: { kind: "position", value: 0 } });
    expect(validateProject(other.project).filter((item) => item.code === "device.kind").map((item) => item.message)[0])
      .toBe(`"arm" is used as a motor and as a servo. Use it as one kind of device everywhere.`);
  });

  it("keeps actions off Pedro's drive motors, and warns about devices missing from the robot", () => {
    const { project } = withRoutine(motor("a", "lf", { kind: "power", value: 1 }), motor("b", "ghost", { kind: "power", value: 1 }));
    project.robot.drivetrain = {
      frontLeft: { name: "lf", reversed: true }, frontRight: { name: "rf", reversed: false },
      backLeft: { name: "lb", reversed: true }, backRight: { name: "rb", reversed: false },
    };
    project.robot.scan = { scannedAt: "2026-11-10T10:00:00Z", devices: ["lf", "rf", "lb", "rb"].map((name) => ({ name, type: "motor" })) };
    const found = validateProject(project).filter((item) => item.code.startsWith("robot.device"));
    expect(found.map((item) => [item.severity, item.code, item.message])).toEqual([
      ["error", "robot.device.drive", `"lf" is a drive motor. Pedro Pathing drives it, so an action can't.`],
      ["warning", "robot.device.missing", `"ghost" is not in the robot's configuration.`],
    ]);
    expect(found[0].location).toEqual({ programId: project.programs[0].id, stepId: "a" });
  });

  it("warns when a group sets one device twice, and checks the hardware list's own entries", () => {
    const { project } = withRoutine({ id: "g", kind: "together", steps: [motor("a", "intake", { kind: "power", value: 1 }), motor("b", "intake", { kind: "power", value: 0 })] });
    project.robot.hardware = [
      { name: "intake", kind: "motor", reversed: false },
      { name: "intake", kind: "motor", reversed: true },
      { name: "claw", kind: "servo", reversed: false, powerLimit: 0.5 },
    ];
    expect(codes(project)).toEqual(expect.arrayContaining(["warning:step.group.device", "error:hardware.duplicate", "error:hardware.limit"]));
    expect(describeLocation(project, { robot: true, hardware: "claw" })).toBe(`Robot hardware "claw"`);
  });
});
