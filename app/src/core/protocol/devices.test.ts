import { describe, expect, it } from "vitest";
import sample from "../../../../fixtures/projects/sample-robot.json";
import { parseProject } from "../ir/schema";
import type { HardwareDevice } from "../ir/types";
import { describeReport, fromSimulator, readDeviceReports, readMechanisms } from "./devices";

const project = () => parseProject(structuredClone(sample));
const stateOf = (reports: Parameters<typeof readMechanisms>[1], name: string, hardware?: HardwareDevice[]) => {
  // The sample is a version 2 project: upgrading it moves the intake's reversed servo into the hardware list.
  const sampleProject = project();
  const reading = readMechanisms(sampleProject.subsystems, reports, hardware ?? sampleProject.robot.hardware).find((item) => item.subsystem.name === name)!;
  return reading.subsystem.states.find((state) => state.id === reading.stateId)?.name ?? null;
};

describe("simulator device reports", () => {
  it("keeps well-formed reports only", () => {
    expect(readDeviceReports({ claw: { type: "servo", position: 0.8 }, lift: { type: "motor", power: Infinity, position: 12 }, bad: "x", other: { power: 1 } }))
      .toEqual({ claw: { type: "servo", position: 0.8 }, lift: { type: "motor", position: 12 } });
    expect(readDeviceReports(null)).toEqual({});
  });

  it("names the state each mechanism's devices match", () => {
    // The claw servo's position, the lift's encoder at its target, and continuous servos' powers.
    expect(stateOf({ claw: { type: "servo", position: 0.8 } }, "Claw")).toBe("Open");
    expect(stateOf({ claw: { type: "servo", position: 0.5 } }, "Claw")).toBeNull();
    expect(stateOf({ lift_motor: { type: "motor", power: 1, position: 1790 } }, "Lift")).toBe("High Basket");
    expect(stateOf({ lift_motor: { type: "motor", power: 0.1, position: 900 } }, "Lift")).toBe("Hold");
    expect(stateOf({ intake_left: { type: "crservo", power: 1 } }, "Intake")).toBeNull();
  });

  it("reads a reversed device's power as the OpMode set it, before its direction", () => {
    // Out gives both intake servos -0.6; intake_right is reversed, so it turns the other way, but reports -0.6 as getPower() does.
    expect(stateOf({ intake_left: { type: "crservo", power: -0.6 }, intake_right: { type: "crservo", power: -0.6 } }, "Intake")).toBe("Out");
    expect(stateOf({ intake_left: { type: "crservo", power: -0.6 }, intake_right: { type: "crservo", power: 0.6 } }, "Intake")).toBeNull();
  });

  it("matches powers cut to each device's limit, as Lumière's code sends them", () => {
    const limited: HardwareDevice[] = [
      { name: "intake_left", kind: "crservo", reversed: false, powerLimit: 0.5 },
      { name: "intake_right", kind: "crservo", reversed: true, powerLimit: 0.5 },
    ];
    // In asks for 1, which runs at 0.5; Out asks for -0.6, which runs at -0.5.
    expect(stateOf({ intake_left: { type: "crservo", power: 0.5 }, intake_right: { type: "crservo", power: 0.5 } }, "Intake", limited)).toBe("In");
    expect(stateOf({ intake_left: { type: "crservo", power: -0.5 }, intake_right: { type: "crservo", power: -0.5 } }, "Intake", limited)).toBe("Out");
    expect(stateOf({ intake_left: { type: "crservo", power: 1 }, intake_right: { type: "crservo", power: 1 } }, "Intake", limited)).toBeNull();
    // Without a limit, a device runs at what is asked.
    expect(stateOf({ intake_left: { type: "crservo", power: 1 }, intake_right: { type: "crservo", power: 1 } }, "Intake")).toBe("In");
  });

  it("turns an older simulator's reversed continuous servo back to the power the OpMode set", () => {
    // Before 0.4.0, the simulator gave a continuous servo's power after its direction.
    const hardware: HardwareDevice[] = [{ name: "intake_right", kind: "crservo", reversed: true }];
    const reports = { intake_left: { type: "crservo", power: -0.6 }, intake_right: { type: "crservo", power: 0.6 } };
    expect(fromSimulator(reports, "0.3.1", hardware)).toEqual({ intake_left: { type: "crservo", power: -0.6 }, intake_right: { type: "crservo", power: -0.6 } });
    expect(stateOf(fromSimulator(reports, "0.3.1", hardware), "Intake")).toBe("Out");
    // 0.4.0 and local builds report it as set already, and so does a stream that gives no version.
    for (const library of ["0.4.0", "0.0.0-local", undefined]) expect(fromSimulator(reports, library, hardware)).toBe(reports);
  });

  it("describes a device's values", () => {
    expect(describeReport({ kind: "motor" }, { type: "motor", power: 0.6, position: 1240.4 })).toBe("power 0.60 · 1240 ticks");
    expect(describeReport({ kind: "servo" }, { type: "servo", position: null })).toBe("position not set");
    expect(describeReport({ kind: "crservo" }, { type: "crservo", power: -1 })).toBe("power -1.00");
    expect(describeReport({ kind: "motor" }, undefined)).toBe("Not reported");
  });
});
