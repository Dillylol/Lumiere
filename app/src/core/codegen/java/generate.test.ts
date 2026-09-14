// @vitest-environment node
import { describe, expect, it } from "vitest";
import awkward from "../../../../../fixtures/projects/awkward-names.json";
import sample from "../../../../../fixtures/projects/sample-robot.json";
import { parseProject } from "../../ir/schema";
import type { Project } from "../../ir/types";
import { checkJavaTarget, defaultJavaPackage, generateJava } from "./generate";
import { ownershipOf, planWrites } from "./ownership";

/**
 * Golden files live in fixtures/golden/<project>/ and are compiled against the FTC SDK, Pedro
 * Pathing, Ivy, and Panels by the Quickstart CI job. Regenerate them with UPDATE_GOLDEN=1.
 */
const golden = import.meta.glob("../../../../../fixtures/golden/**/*.java", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const goldenRoot = "../../../../../fixtures/golden/";
const update = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.UPDATE_GOLDEN === "1";

const projects: [string, Project][] = [
  ["sample-robot", parseProject(sample)],
  ["awkward-names", parseProject(awkward)],
];

describe("Java generation", () => {
  for (const [slug, project] of projects) {
    it(`matches the golden files for ${slug}`, async () => {
      const result = generateJava(project);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
      if (update) {
        const fs = await import(/* @vite-ignore */ ["node", "fs"].join(":"));
        const directory = new URL(`../../../../../fixtures/golden/${slug}/`, import.meta.url);
        fs.rmSync(directory, { recursive: true, force: true });
        for (const file of result.files) {
          const target = new URL(file.path, directory);
          fs.mkdirSync(new URL(".", target), { recursive: true });
          fs.writeFileSync(target, file.content);
        }
        return;
      }
      const prefix = `${goldenRoot}${slug}/`;
      const expectedPaths = Object.keys(golden).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)).sort();
      expect(result.files.map((file) => file.path)).toEqual(expectedPaths);
      for (const file of result.files) {
        expect(file.content, file.path).toBe(golden[`${prefix}${file.path}`]);
      }
    });
  }

  it("is deterministic", () => {
    const [, project] = projects[0];
    const first = generateJava(project);
    const second = generateJava(structuredClone(project));
    expect(second).toEqual(first);
  });

  it("marks every file as generated and unedited", () => {
    const result = generateJava(projects[0][1]);
    if (!result.ok) throw new Error("generation failed");
    for (const file of result.files) expect(ownershipOf(file.content)).toBe("generated");
  });

  it("refuses to generate while the project has errors", () => {
    const broken = structuredClone(projects[0][1]);
    broken.programs[1].name = broken.programs[0].name;
    const result = generateJava(broken);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((item) => item.code === "program.name.duplicate")).toBe(true);
  });

  it("plans writes without overwriting hand edits or team files", () => {
    const result = generateJava(projects[0][1]);
    if (!result.ok) throw new Error("generation failed");
    const [a, b, c, d] = result.files;
    const existing = new Map<string, string>([
      [b.path, b.content.replace(/\n/g, "\r\n")],
      [c.path, c.content.replace("public class", "public   class")],
      [d.path, "package mine;\nclass Mine {}\n"],
    ]);
    const plan = planWrites([a, b, c, d], existing);
    expect(plan.map((entry) => entry.action)).toEqual(["create", "unchanged", "conflict", "skip"]);
  });

  it("writes to a chosen package and uses a chosen constants class", () => {
    const project = projects[0][1];
    const target = { javaPackage: "org.firstinspires.ftc.teamcode.auto.studio", constantsClass: "org.firstinspires.ftc.teamcode.pedroPathing.RobotConstants" };
    const result = generateJava(project, target);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.packageName).toBe(target.javaPackage);
    for (const file of result.files) {
      expect(file.path.startsWith("TeamCode/src/main/java/org/firstinspires/ftc/teamcode/auto/studio/")).toBe(true);
      expect(file.content).toContain("package org.firstinspires.ftc.teamcode.auto.studio;");
      expect(file.content).not.toContain("teamcode.pedro.Constants");
    }
    const opModes = result.files.filter((file) => file.content.includes("extends OpMode"));
    expect(opModes.length).toBeGreaterThan(0);
    for (const file of opModes) {
      expect(file.content).toContain("import org.firstinspires.ftc.teamcode.pedroPathing.RobotConstants;");
      expect(file.content).toContain("follower = RobotConstants.create(hardwareMap);");
    }
    const defaults = generateJava(project);
    if (!defaults.ok) throw new Error("generation failed");
    expect(defaults.packageName).toBe(defaultJavaPackage(project));
  });

  it("rejects package and class names Java cannot compile", () => {
    for (const javaPackage of ["org.first-inspires", "org..teamcode", "org.teamcode.class", ""]) {
      expect(checkJavaTarget({ javaPackage }), javaPackage).not.toBeNull();
    }
    for (const constantsClass of ["Constants", "org.teamcode.constants", "org.teamcode.2Fast"]) {
      expect(checkJavaTarget({ constantsClass }), constantsClass).not.toBeNull();
    }
    expect(checkJavaTarget({ javaPackage: "org.firstinspires.ftc.teamcode.auto", constantsClass: "org.firstinspires.ftc.teamcode.pedro.Constants" })).toBeNull();
    const result = generateJava(projects[0][1], { javaPackage: "not valid" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain("target.invalid");
  });

  it("keeps generated class names from shadowing the constants class", () => {
    const project = structuredClone(projects[0][1]);
    project.subsystems[0].name = "Robot Constants";
    const result = generateJava(project, { constantsClass: "org.firstinspires.ftc.teamcode.pedro.RobotConstants" });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.files.some((file) => file.path.endsWith("/RobotConstants.java"))).toBe(false);
    expect(result.files.some((file) => file.path.endsWith("/RobotConstants2.java"))).toBe(true);
  });
});
