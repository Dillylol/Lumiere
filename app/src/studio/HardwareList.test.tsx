import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createAutonomous, createDevice, createProject, createState, createSubsystem, type Project } from "../core";
import { HardwareList } from "./HardwareList";
import { Mechanisms } from "./Mechanisms";
import { ProgramEditor } from "./ProgramEditor";

/** A robot that has been scanned: Pedro's four drive motors, an intake motor, a claw servo and an IMU. */
function scannedProject(): Project {
  const project = createProject("Bench");
  project.robot.drivetrain = {
    frontLeft: { name: "lf", reversed: true }, frontRight: { name: "rf", reversed: false },
    backLeft: { name: "lb", reversed: true }, backRight: { name: "rb", reversed: false },
  };
  project.robot.scan = { scannedAt: "2026-11-10T10:00:00Z", devices: [
    { name: "lf", type: "motor" }, { name: "rf", type: "motor" }, { name: "lb", type: "motor" }, { name: "rb", type: "motor" },
    { name: "intake", type: "motor" }, { name: "claw", type: "servo" }, { name: "imu", type: "imu" },
  ] };
  project.programs.push(createAutonomous("Main Auto"));
  return project;
}

/** Renders a panel against a project held in state, as the Robot page does, and exposes the latest project. */
function Harness({ initial, panel, seen }: { initial: Project; panel: "hardware" | "mechanisms" | "build"; seen: { project?: Project } }) {
  const [project, setProject] = useState(initial);
  seen.project = project;
  const program = project.programs[0];
  return panel === "hardware" ? <HardwareList project={project} onChange={setProject}/>
    : panel === "mechanisms" ? <Mechanisms project={project} onChange={setProject}/>
      : <ProgramEditor project={project} program={program} onChange={(next) => setProject({ ...project, programs: [next] })}/>;
}

describe("the hardware list", () => {
  afterEach(cleanup);

  it("lists the scanned motors and servos without Pedro's drive motors, and stores settings per device", async () => {
    const seen: { project?: Project } = {};
    render(<Harness initial={scannedProject()} panel="hardware" seen={seen}/>);
    const table = screen.getByRole("table", { name: "Robot hardware" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["intake", "claw"]);
    // Sensors and Pedro's devices are listed on their own.
    expect(within(screen.getByRole("table", { name: "Other devices" })).getByText("imu")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("intake reversed"));
    const limit = screen.getByLabelText("intake power limit");
    await userEvent.clear(limit);
    await userEvent.type(limit, "0.7");
    expect(seen.project?.robot.hardware).toEqual([{ name: "intake", kind: "motor", reversed: true, powerLimit: 0.7 }]);
    // Servos take positions, so they have no power limit.
    expect(screen.queryByLabelText("claw power limit")).toBeNull();
  });

  it("adds a device by name before the robot is scanned, and removes it while nothing uses it", async () => {
    const seen: { project?: Project } = {};
    render(<Harness initial={createProject("Unscanned")} panel="hardware" seen={seen}/>);
    await userEvent.type(screen.getByLabelText("Add a device by name"), " lift ");
    await userEvent.selectOptions(screen.getByLabelText("Type"), "motor");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(seen.project?.robot.hardware).toEqual([{ name: "lift", kind: "motor", reversed: false }]);
    expect(screen.getByRole("rowheader", { name: "lift" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Add a device by name"), "lift");
    expect(screen.getByRole("alert")).toHaveTextContent(`"lift" is already in the list.`);
    await userEvent.click(screen.getByRole("button", { name: "Remove lift" }));
    expect(seen.project?.robot.hardware).toBeUndefined();
  });

  it("offers a travel range for a motor once something sends it to an encoder target", async () => {
    const project = createProject("Travel");
    const lift = createSubsystem("Lift");
    const motor = createDevice("lift", "motor");
    lift.devices.push(motor);
    const up = createState("Up");
    up.outputs[motor.id] = { kind: "target", ticks: 1000, power: 0.5 };
    lift.states.push(up);
    project.subsystems.push(lift);
    const seen: { project?: Project } = {};
    render(<Harness initial={project} panel="hardware" seen={seen}/>);
    await userEvent.click(screen.getByRole("checkbox", { name: "Limit" }));
    expect(seen.project?.robot.hardware?.[0].travel).toEqual({ minTicks: -100, maxTicks: 1100 });
    expect(screen.getByLabelText("lift highest ticks")).toHaveValue(1100);
  });
});

describe("mechanisms and device actions", () => {
  afterEach(cleanup);

  it("starts a new mechanism on a free device from the hardware list", async () => {
    const seen: { project?: Project } = {};
    render(<Harness initial={scannedProject()} panel="mechanisms" seen={seen}/>);
    await userEvent.click(screen.getByRole("button", { name: "Add mechanism" }));
    const mechanism = seen.project!.subsystems[0];
    expect(mechanism.devices.map((device) => [device.name, device.kind])).toEqual([["claw", "servo"]]);
    // Once scanned, devices are chosen from what the robot reported; Pedro's drive motors are not offered.
    const picker = screen.getByLabelText("Device");
    expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual(["Choose a device", "intake (motor)", "claw (servo)"]);
    await userEvent.selectOptions(picker, "intake");
    expect(seen.project!.subsystems[0].devices[0]).toMatchObject({ name: "intake", kind: "motor" });
    expect(seen.project!.subsystems[0].states[0].outputs[mechanism.devices[0].id]).toEqual({ kind: "power", value: 0 });
  });

  it("adds a Motor action on the first motor, and says when its power limit cuts the power", async () => {
    const project = scannedProject();
    project.robot.hardware = [{ name: "intake", kind: "motor", reversed: false, powerLimit: 0.6 }];
    const seen: { project?: Project } = {};
    render(<Harness initial={project} panel="build" seen={seen}/>);
    const add = screen.getByRole("combobox", { name: "Add action" });
    expect(within(add).getByRole("option", { name: "Continuous servo (the robot has no continuous servos)" })).toBeDisabled();
    await userEvent.selectOptions(add, "device:motor");
    const auto = seen.project!.programs[0];
    expect(auto.kind === "autonomous" && auto.routine[0]).toMatchObject({ kind: "device", device: "intake", deviceKind: "motor", output: { kind: "power", value: 0 } });
    expect(screen.getByText("intake: power 0")).toBeInTheDocument();

    const power = screen.getByLabelText("Power");
    await userEvent.clear(power);
    await userEvent.type(power, "0.9");
    expect(screen.getByRole("note")).toHaveTextContent("Runs at 0.6: intake's power limit.");
    await userEvent.selectOptions(screen.getByLabelText("Control"), "target");
    expect(screen.getByLabelText("Target ticks")).toBeInTheDocument();
  });

  it("lets a name be typed before the robot is scanned", async () => {
    const project = createProject("Unscanned");
    project.programs.push(createAutonomous("Main Auto"));
    const seen: { project?: Project } = {};
    render(<Harness initial={project} panel="build" seen={seen}/>);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Add action" }), "device:servo");
    expect(screen.getByText("Choose a servo")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Servo"), "kicker");
    const auto = seen.project!.programs[0];
    expect(auto.kind === "autonomous" && auto.routine[0]).toMatchObject({ device: "kicker", deviceKind: "servo", output: { kind: "position", value: 0 } });
  });
});

describe("timed actions in Build", () => {
  afterEach(cleanup);

  it("times a mechanism action, ending in its starting state, and can untime it", async () => {
    const project = createProject("Timed");
    const intake = createSubsystem("Intake");
    const on = createState("In"), off = createState("Off");
    intake.states.push(on, off);
    intake.initialStateId = off.id;
    project.subsystems.push(intake);
    const auto = createAutonomous("Main Auto");
    auto.routine.push({ id: "step_a", kind: "state", subsystemId: intake.id, stateId: on.id });
    project.programs.push(auto);
    const seen: { project?: Project } = {};
    render(<Harness initial={project} panel="build" seen={seen}/>);
    const routine = () => { const program = seen.project!.programs[0]; return program.kind === "autonomous" ? program.routine : []; };

    await userEvent.click(screen.getByRole("button", { name: /Set mechanism state/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: "For a set time" }));
    expect(routine()[0]).toMatchObject({ duration: { ms: 1000, thenStateId: off.id } });
    expect(screen.getByText("Intake: In for 1.0 s, then Off")).toBeInTheDocument();

    const time = screen.getByLabelText("Duration (s)");
    await userEvent.clear(time);
    await userEvent.type(time, "2.5");
    expect(routine()[0]).toMatchObject({ duration: { ms: 2500 } });
    await userEvent.click(screen.getByRole("checkbox", { name: "For a set time" }));
    expect(routine()[0]).not.toHaveProperty("duration");
  });

  it("times a servo action with the position after, and a motor with stopping after", async () => {
    const project = scannedProject();
    const seen: { project?: Project } = {};
    render(<Harness initial={project} panel="build" seen={seen}/>);
    const routine = () => { const program = seen.project!.programs[0]; return program.kind === "autonomous" ? program.routine : []; };
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Add action" }), "device:servo");
    await userEvent.click(screen.getByRole("checkbox", { name: "For a set time" }));
    expect(routine()[0]).toMatchObject({ device: "claw", duration: { ms: 1000, thenPosition: 0 } });
    const after = screen.getByLabelText("Then position");
    await userEvent.clear(after);
    await userEvent.type(after, "0.4");
    expect(routine()[0]).toMatchObject({ duration: { thenPosition: 0.4 } });
    expect(screen.getByText("claw: position 0 for 1.0 s, then position 0.4")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Add action" }), "device:motor");
    await userEvent.click(screen.getByRole("checkbox", { name: "For a set time" }));
    expect(screen.getByText("Then it stops (power 0).")).toBeInTheDocument();
    expect(routine()[1]).toMatchObject({ device: "intake", duration: { ms: 1000 } });
  });
});
