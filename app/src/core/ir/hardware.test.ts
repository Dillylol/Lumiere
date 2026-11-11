import { describe, expect, it } from "vitest";
import { createAutonomous, createDevice, createProject, createSubsystem } from "./create";
import { describeDeviceStep } from "./describe";
import { deviceUses, hardwareList, limitPower, powerLimitOf, withHardware, withoutHardware } from "./hardware";
import type { DeviceStep, Project } from "./types";

const step = (device: string, output: DeviceStep["output"], deviceKind: DeviceStep["deviceKind"] = "motor"): DeviceStep =>
  ({ id: `step_${device}`, kind: "device", device, deviceKind, output });

function robotProject(): Project {
  const project = createProject("Hardware");
  project.robot.drivetrain = {
    frontLeft: { name: "lf", reversed: true }, frontRight: { name: "rf", reversed: false },
    backLeft: { name: "lb", reversed: true }, backRight: { name: "rb", reversed: false },
  };
  project.robot.localizer = { kind: "threewheel", devices: [{ role: "leftEncoder", name: "intake" }] };
  project.robot.scan = { scannedAt: "2026-11-10T10:00:00Z", devices: [
    { name: "lf", type: "motor" }, { name: "rf", type: "motor" }, { name: "lb", type: "motor" }, { name: "rb", type: "motor" },
    { name: "intake", type: "motor" }, { name: "claw", type: "servo" }, { name: "imu", type: "imu" },
  ] };
  return project;
}

describe("the hardware list", () => {
  it("lists the project's entries, then scanned motors and servos, then devices only the project names", () => {
    const project = robotProject();
    project.robot.hardware = [{ name: "claw", kind: "servo", reversed: true }];
    const lift = createSubsystem("Lift");
    lift.devices.push(createDevice("lift", "motor"));
    project.subsystems.push(lift);
    const auto = createAutonomous("Auto");
    auto.routine.push({ id: "g", kind: "together", steps: [step("spinner", { kind: "power", value: 1 }, "crservo")] });
    project.programs.push(auto);

    // Pedro's drive motors are left out; the motor on a dead wheel's port stays, and sensors are not drivable.
    expect(hardwareList(project)).toEqual([
      { name: "claw", kind: "servo", reversed: true },
      { name: "intake", kind: "motor", reversed: false },
      { name: "lift", kind: "motor", reversed: false },
      { name: "spinner", kind: "crservo", reversed: false },
    ]);
    expect([...deviceUses(project).keys()]).toEqual(["lift", "spinner"]);
  });

  it("stores settings per device, and removing them goes back to the defaults", () => {
    const project = robotProject();
    const robot = withHardware(project.robot, { name: "intake", kind: "motor", reversed: false, powerLimit: 0.7 });
    expect(powerLimitOf(robot, " intake ")).toBe(0.7);
    expect(powerLimitOf(robot, "claw")).toBe(1);
    const changed = withHardware(robot, { name: "intake", kind: "motor", reversed: true });
    expect(changed.hardware).toEqual([{ name: "intake", kind: "motor", reversed: true }]);
    expect(withoutHardware(changed, "intake").hardware).toBeUndefined();
  });

  it("cuts powers to a limit in either direction", () => {
    expect(limitPower(0.9, 0.7)).toBe(0.7);
    expect(limitPower(-0.9, 0.7)).toBe(-0.7);
    expect(limitPower(0.5, 0.7)).toBe(0.5);
  });

  it("describes device actions, and what is still to choose", () => {
    expect(describeDeviceStep(step("intake", { kind: "power", value: 0.5 }))).toBe("intake: power 0.5");
    expect(describeDeviceStep(step("claw", { kind: "position", value: 0.25 }, "servo"))).toBe("claw: position 0.25");
    expect(describeDeviceStep(step("lift", { kind: "target", ticks: 1200.4, power: 0.8 }))).toBe("lift: 1200 ticks at power 0.8");
    expect(describeDeviceStep(step(" ", { kind: "power", value: 0 }, "crservo"))).toBe("Choose a continuous servo");
  });
});
