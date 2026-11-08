import { beforeEach, describe, expect, it } from "vitest";
import { createProject } from "../core";
import { recovery, robotHost, saveRobotHost, stage } from "./store";

const RECOVERY_KEY = "studio-v2-recovery";

describe("recovery drafts", () => {
  beforeEach(() => localStorage.clear());

  it("keeps every readable draft when another one no longer parses", () => {
    const good = createProject("Good");
    const broken = { ...createProject("Broken"), robot: { widthInches: 2, lengthInches: 18, maxVelocity: 50, maxAcceleration: 60 } };
    localStorage.setItem(RECOVERY_KEY, JSON.stringify({ [good.id]: good, [broken.id]: broken }));

    expect(Object.keys(recovery())).toEqual([good.id]);
  });

  it("leaves an unreadable draft in storage when another project is staged", () => {
    const broken = { ...createProject("Broken"), robot: { widthInches: 2, lengthInches: 18, maxVelocity: 50, maxAcceleration: 60 } };
    localStorage.setItem(RECOVERY_KEY, JSON.stringify({ [broken.id]: broken }));
    const next = createProject("Next");

    stage(next);

    const stored = JSON.parse(localStorage.getItem(RECOVERY_KEY) ?? "{}");
    expect(Object.keys(stored).sort()).toEqual([broken.id, next.id].sort());
    expect(stored[broken.id].robot.widthInches).toBe(2);
    expect(Object.keys(recovery())).toEqual([next.id]);
  });

  it("starts empty when the stored drafts are not an object", () => {
    localStorage.setItem(RECOVERY_KEY, "[1, 2]");
    expect(recovery()).toEqual({});
    const project = createProject("Fresh");
    stage(project);
    expect(Object.keys(recovery())).toEqual([project.id]);
  });
});

describe("robot address", () => {
  beforeEach(() => localStorage.clear());

  it("remembers the Control Hub address per project and defaults to the Control Hub", () => {
    expect(robotHost("project-a")).toBe("192.168.43.1");
    saveRobotHost("project-a", " 192.168.49.1 ");
    expect(robotHost("project-a")).toBe("192.168.49.1");
    expect(robotHost("project-b")).toBe("192.168.43.1");
  });

  it("ignores a cleared field instead of forgetting the last address", () => {
    saveRobotHost("project-a", "10.0.0.5");
    saveRobotHost("project-a", "   ");
    expect(robotHost("project-a")).toBe("10.0.0.5");
  });
});
