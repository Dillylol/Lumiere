import { describe, expect, it } from "vitest";
import { parseJules } from "../language/julesLanguage";
import { cloneProject, createProject, parseProject } from "./project";

describe("JULES project document", () => {
  it("creates a valid portable v1 project", () => {
    const source = "stop()";
    const project = createProject("Test robot", "beginner", "autonomous", source, parseJules(source).ir);
    expect(parseProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
    expect(project.workspace.runTarget).toBe("simulator");
  });

  it("duplicates without reusing project or program identifiers", () => {
    const source = "stop()";
    const project = createProject("Original", "advanced", "utility", source, parseJules(source).ir);
    const copy = cloneProject(project);
    expect(copy.id).not.toBe(project.id);
    expect(copy.programs[0].id).not.toBe(project.programs[0].id);
    expect(copy.programs[0].source).toBe(project.programs[0].source);
  });

  it("rejects unknown project schema versions", () => {
    expect(() => parseProject({ schemaVersion: 99 })).toThrow();
  });
});

