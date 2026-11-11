import { describe, expect, it } from "vitest";
import { createProject } from "./create";
import { describeDeviceStep, describeStateStep, seconds } from "./describe";
import type { Project } from "./types";

function rollerProject(): Project {
  const project = createProject("Describe");
  project.subsystems.push({ id: "intake", name: "Intake", initialStateId: null, devices: [], states: [
    { id: "in", name: "In", outputs: {} },
    { id: "off", name: "Off", outputs: {} },
  ] });
  return project;
}

describe("action descriptions", () => {
  it("names a mechanism action, its time and the state after", () => {
    const project = rollerProject();
    expect(describeStateStep(project, { id: "a", kind: "state", subsystemId: "intake", stateId: "in" })).toBe("Intake: In");
    expect(describeStateStep(project, { id: "a", kind: "state", subsystemId: "intake", stateId: "in", duration: { ms: 2000, thenStateId: "off" } }))
      .toBe("Intake: In for 2.0 s, then Off");
    expect(describeStateStep(project, { id: "a", kind: "state", subsystemId: "intake", stateId: "in", duration: { ms: 1250, thenStateId: "" } }))
      .toBe("Intake: In for 1.3 s, then choose a state");
    expect(describeStateStep(project, { id: "a", kind: "state", subsystemId: "", stateId: "" })).toBe("Choose a mechanism");
    expect(describeStateStep(project, { id: "a", kind: "state", subsystemId: "gone", stateId: "" })).toBe("Mechanism missing");
  });

  it("names a device action, its time and what happens after", () => {
    expect(describeDeviceStep({ id: "a", kind: "device", device: "intake", deviceKind: "motor", output: { kind: "power", value: 0.5 }, duration: { ms: 2000 } }))
      .toBe("intake: power 0.5 for 2.0 s, then off");
    expect(describeDeviceStep({ id: "a", kind: "device", device: "kicker", deviceKind: "servo", output: { kind: "position", value: 0.6 }, duration: { ms: 500, thenPosition: 0.2 } }))
      .toBe("kicker: position 0.6 for 0.5 s, then position 0.2");
    expect(seconds(30_000)).toBe("30.0 s");
  });
});
