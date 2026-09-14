import { describe, expect, it } from "vitest";
import { parseJules } from "../language/julesLanguage";
import { previewSteps } from "./previewMotion";

const preview = (source: string) => previewSteps(parseJules(source).ir.actions, { x: 72, y: 72, heading: 0 });

describe("legacy kinematic preview", () => {
  it("drives along +x at heading zero and turns left counterclockwise", () => {
    const steps = preview("drive.forward(1, 1000)\nturn.left(1, 1000)\ndrive.forward(1, 1000)");
    expect(steps[0].to).toEqual({ x: 108, y: 72, heading: 0 });
    expect(steps[1].to.heading).toBe(90);
    expect(steps[2].to.x).toBeCloseTo(108);
    expect(steps[2].to.y).toBeCloseTo(108);
  });
  it("preserves long waits and stops before subsequent motion", () => {
    const steps = preview("wait(5000)\nstop()\ndrive.forward(1, 1000)");
    expect(steps).toHaveLength(1);
    expect(steps[0].duration).toBe(5000);
    expect(steps[0].to).toEqual(steps[0].from);
  });
  it("keeps planned waypoints and reverse travel inside the field", () => {
    const steps = preview("drive.backward(1, 10000)");
    expect(steps[0].to).toEqual({ x: 0, y: 72, heading: 0 });
  });
});
