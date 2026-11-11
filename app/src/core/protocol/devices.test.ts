import { describe, expect, it } from "vitest";
import sample from "../../../../fixtures/projects/sample-robot.json";
import { parseProject } from "../ir/schema";
import { describeReport, readDeviceReports, readMechanisms } from "./devices";

const project = () => parseProject(structuredClone(sample));
const stateOf = (reports: Parameters<typeof readMechanisms>[1], name: string) => {
  // The sample is a version 3 project: upgrading it moves the intake's reversed servo into the hardware list.
  const sampleProject = project();
  const reading = readMechanisms(sampleProject.subsystems, reports, sampleProject.robot.hardware).find((item) => item.subsystem.name === name)!;
  return reading.subsystem.states.find((state) => state.id === reading.stateId)?.name ?? null;
};

describe("simulator device reports", () => {
  it("keeps well-formed reports only", () => {
    expect(readDeviceReports({ claw: { type: "servo", position: 0.8 }, lift: { type: "motor", power: Infinity, position: 12 }, bad: "x", other: { power: 1 } }))
      .toEqual({ claw: { type: "servo", position: 0.8 }, lift: { type: "motor", position: 12 } });
    expect(readDeviceReports(null)).toEqual({});
  });

  it("names the state each mechanism's devices match", () => {
    // The claw servo's position, the lift's encoder at its target, and a reversed continuous servo's power.
    expect(stateOf({ claw: { type: "servo", position: 0.8 } }, "Claw")).toBe("Open");
    expect(stateOf({ claw: { type: "servo", position: 0.5 } }, "Claw")).toBeNull();
    expect(stateOf({ lift_motor: { type: "motor", power: 1, position: 1790 } }, "Lift")).toBe("High Basket");
    expect(stateOf({ lift_motor: { type: "motor", power: 0.1, position: 900 } }, "Lift")).toBe("Hold");
    expect(stateOf({ intake_left: { type: "crservo", power: -0.6 }, intake_right: { type: "crservo", power: 0.6 } }, "Intake")).toBe("Out");
    expect(stateOf({ intake_left: { type: "crservo", power: 1 } }, "Intake")).toBeNull();
  });

  it("describes a device's values", () => {
    expect(describeReport({ kind: "motor", reversed: true }, { type: "motor", power: 0.6, position: 1240.4 })).toBe("power 0.60 · 1240 ticks");
    expect(describeReport({ kind: "servo", reversed: false }, { type: "servo", position: null })).toBe("position not set");
    expect(describeReport({ kind: "crservo", reversed: true }, { type: "crservo", power: -1 })).toBe("power 1.00");
    expect(describeReport({ kind: "motor", reversed: false }, undefined)).toBe("Not reported");
  });
});
