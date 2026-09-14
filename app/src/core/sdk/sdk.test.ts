import { describe, expect, it } from "vitest";
import sample from "../../../../fixtures/projects/sample-robot.json";
import sources from "../../../../quickstart/sources.json";
import { BRAND } from "../../brand";
import { generateJava } from "../codegen/java/generate";
import { parseProject } from "../ir/schema";
import { defaultDeploySettings, describeDeploy, planDeploy, type DeployPlan, type DeploySettings } from "./deploy";
import { inspectFtcProject } from "./ftcProject";

type NodeFs = { readFileSync(path: string, encoding: "utf8"): string };
const nodeFs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as NodeFs;
const repository = `${(globalThis as unknown as { process: { cwd(): string } }).process.cwd()}/..`;
const overlay = (path: string) => nodeFs.readFileSync(`${repository}/quickstart/overlay/${path}`, "utf8");
const tokens: Record<string, string> = { ...sources.versions, APP_NAME: BRAND.name, ROBOT_LIBRARY_COORDINATES: BRAND.java.package, ROBOT_LIBRARY_VERSION: "0.0.0-local" };
const substitute = (text: string) => text.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => tokens[key] ?? "");

const JAVA = "TeamCode/src/main/java/org/firstinspires/ftc/teamcode";

/** The build files of a new FTC SDK project, written from scratch for the test. */
function plainSdk(version = "12.0.0"): Map<string, string> {
  return new Map([
    ["settings.gradle", "include ':FtcRobotController'\ninclude ':TeamCode'\n"],
    ["build.dependencies.gradle", `dependencies {\n    implementation 'org.firstinspires.ftc:RobotCore:${version}'\n    implementation 'org.firstinspires.ftc:Hardware:${version}'\n}\n`],
    ["TeamCode/build.gradle", "apply plugin: 'com.android.application'\napply from: '../build.common.gradle'\napply from: '../build.dependencies.gradle'\n\ndependencies {\n    implementation project(':FtcRobotController')\n}\n"],
    ["gradlew", "#!/bin/sh\n"],
    ["gradlew.bat", "@echo off\n"],
  ]);
}

function quickstartProject(): Map<string, string> {
  const files = plainSdk();
  files.set("TeamCode/build.gradle", `${files.get("TeamCode/build.gradle")}\napply from: 'libraries.gradle'\n`);
  files.set("TeamCode/libraries.gradle", substitute(overlay("TeamCode/libraries.gradle")));
  files.set(`${JAVA}/pedro/Constants.java`, overlay("TeamCode/src/main/java/org/firstinspires/ftc/teamcode/pedro/Constants.java"));
  files.set(`${JAVA}/examples/ExampleAuto.java`, overlay("TeamCode/src/main/java/org/firstinspires/ftc/teamcode/examples/ExampleAuto.java"));
  return files;
}

const project = () => parseProject(structuredClone(sample));

describe("inspectFtcProject", () => {
  it("recognizes a plain FTC SDK project that still needs the libraries", () => {
    const inspection = inspectFtcProject({ files: plainSdk() });
    expect(inspection.isFtcProject).toBe(true);
    expect(inspection.sdkVersion).toBe("12.0.0");
    expect(inspection.warnings).toEqual([]);
    expect(inspection.librariesReady).toBe(false);
    expect(inspection.libraries.filter((library) => !library.ok).map((library) => library.name)).toEqual([
      "Pedro Pathing", "Ivy commands", "Ivy Pedro Pathing commands", "Robot library (live data and headings)",
    ]);
    expect(inspection.constantsClasses).toEqual([]);
  });

  it("explains folders that are not FTC SDK projects", () => {
    const inspection = inspectFtcProject({ files: new Map([["README.md", "hello"]]) });
    expect(inspection.isFtcProject).toBe(false);
    expect(inspection.problems.join(" ")).toMatch(/TeamCode/);
    expect(inspection.problems.join(" ")).toMatch(/gradlew/);
  });

  it("finds the quickstart libraries, constants class, and OpModes", () => {
    const inspection = inspectFtcProject({ files: quickstartProject() });
    expect(inspection.librariesReady).toBe(true);
    expect(inspection.libraries.find((library) => library.artifact === "com.pedropathing:revhub")?.found).toBe(sources.versions.PEDRO_VERSION);
    expect(inspection.constantsClasses).toEqual([{ qualifiedName: "org.firstinspires.ftc.teamcode.pedro.Constants", path: `${JAVA}/pedro/Constants.java` }]);
    expect(inspection.opModes.map((opMode) => opMode.name)).toEqual(["Example Auto"]);
  });

  it("only counts libraries.gradle when TeamCode applies it, and ignores commented dependencies", () => {
    const files = quickstartProject();
    files.set("TeamCode/build.gradle", plainSdk().get("TeamCode/build.gradle")!.replace("dependencies {", "// apply from: 'libraries.gradle'\ndependencies {\n    // implementation 'com.pedropathing.ivy:core:1.1.1'"));
    expect(inspectFtcProject({ files }).librariesReady).toBe(false);
  });

  it("flags Pedro Pathing 2 and other SDK versions", () => {
    const files = plainSdk("11.2.1");
    files.set("TeamCode/build.gradle", `${files.get("TeamCode/build.gradle")}\ndependencies {\n    implementation 'com.pedropathing:ftc:2.0.1'\n}\n`);
    files.set(`${JAVA}/pedroPathing/Constants.java`, "package org.firstinspires.ftc.teamcode.pedroPathing;\npublic class Constants {\n    public static Follower createFollower(HardwareMap hardwareMap) { return null; }\n}\n");
    const inspection = inspectFtcProject({ files });
    expect(inspection.incompatible.join(" ")).toMatch(/Pedro Pathing 2/);
    expect(inspection.librariesReady).toBe(false);
    expect(inspection.warnings.join(" ")).toMatch(/FTC SDK 11\.2\.1/);
    // Pedro Pathing 2 constants use createFollower, which generated code does not call.
    expect(inspection.constantsClasses).toEqual([]);
  });

  it("recognizes the Pedro Pathing quickstart's own constants class", () => {
    const files = plainSdk();
    files.set("build.dependencies.gradle", `${files.get("build.dependencies.gradle")}\ndependencies {\n    implementation 'com.pedropathing:revhub:3.0.0'\n    implementation 'com.pedropathing:tuning:1.0.0'\n}\n`);
    files.set(`${JAVA}/pedro/Constants.java`, "package org.firstinspires.ftc.teamcode.pedro;\n\npublic class Constants {\n    public static Follower create(HardwareMap h) {\n        return null;\n    }\n}\n");
    const inspection = inspectFtcProject({ files });
    expect(inspection.libraries[0].ok).toBe(true);
    expect(inspection.libraries.slice(1).every((library) => !library.ok)).toBe(true);
    expect(inspection.constantsClasses.map((item) => item.qualifiedName)).toEqual(["org.firstinspires.ftc.teamcode.pedro.Constants"]);
  });
});

describe("planDeploy", () => {
  const settings = (overrides: Partial<DeploySettings> = {}): DeploySettings => ({ ...defaultDeploySettings(project()), ...overrides });
  const expectPlan = (result: ReturnType<typeof planDeploy>): DeployPlan => {
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    return result;
  };
  /** Files on disk after applying a plan. */
  const apply = (plan: DeployPlan, disk: Map<string, string>) => {
    const next = new Map(disk);
    for (const entry of plan.writes) if (entry.action === "create" || entry.action === "update") next.set(entry.path, entry.content);
    for (const removal of plan.removals) next.delete(removal.path);
    return next;
  };

  it("creates every file on the first deploy and changes nothing on the second", () => {
    const first = expectPlan(planDeploy(project(), settings(), new Map()));
    expect(first.writes.every((entry) => entry.action === "create")).toBe(true);
    expect(first.directory).toBe(`${JAVA}/generated/samplerobot`);
    expect(describeDeploy(first)).toBe(`${first.writes.length} created`);
    const disk = apply(first, new Map());
    const second = expectPlan(planDeploy(project(), settings(), disk, first.generatedPaths));
    expect(second.writes.every((entry) => entry.action === "unchanged")).toBe(true);
    expect(second.removals).toEqual([]);
    expect(describeDeploy(second)).toBe(`${first.writes.length} unchanged`);
  });

  it("removes the old class when a program is renamed, but keeps edited and team-owned files", () => {
    const before = project();
    const first = expectPlan(planDeploy(before, settings(), new Map()));
    let disk = apply(first, new Map());
    const renamed = project();
    renamed.programs[0].name = "Blue Basket Fast";
    const old = `${JAVA}/generated/samplerobot/BlueBasket.java`;
    const second = expectPlan(planDeploy(renamed, settings(), disk, first.generatedPaths));
    expect(second.removals.map((removal) => removal.path)).toEqual([old]);
    expect(second.writes.find((entry) => entry.path.endsWith("/BlueBasketFast.java"))?.action).toBe("create");

    disk = new Map(disk).set(old, disk.get(old)!.replace("public class", "public  class"));
    const edited = expectPlan(planDeploy(renamed, settings(), disk, first.generatedPaths));
    expect(edited.removals).toEqual([]);
    expect(edited.kept[0].path).toBe(old);

    const teamOwned = new Map(disk).set(old, "package x;\npublic class BlueBasket {}\n");
    expect(expectPlan(planDeploy(renamed, settings(), teamOwned, first.generatedPaths)).kept[0].reason).toMatch(/took this file over/);
    const keepSetting = expectPlan(planDeploy(renamed, settings({ removeOutdated: false }), apply(first, new Map()), first.generatedPaths));
    expect(keepSetting.removals).toEqual([]);
    expect(keepSetting.kept.map((item) => item.path)).toEqual([old]);
  });

  it("moves files when the package changes and deploys only chosen programs", () => {
    const first = expectPlan(planDeploy(project(), settings(), new Map()));
    const disk = apply(first, new Map());
    const moved = expectPlan(planDeploy(project(), settings({ javaPackage: "org.firstinspires.ftc.teamcode.auto" }), disk, first.generatedPaths));
    expect(moved.removals.map((removal) => removal.path).sort()).toEqual([...first.generatedPaths].sort());
    expect(moved.writes.every((entry) => entry.action === "create" && entry.path.startsWith(`${JAVA}/auto/`))).toBe(true);

    const autoOnly = expectPlan(planDeploy(project(), settings({ programIds: [project().programs[0].id] }), disk, first.generatedPaths));
    expect(autoOnly.removals.map((removal) => removal.path)).toEqual([`${JAVA}/generated/samplerobot/DriverControl.java`]);
  });

  it("overwrites hand-edited generated files only when asked", () => {
    const first = expectPlan(planDeploy(project(), settings(), new Map()));
    const path = first.generatedPaths[0];
    const disk = apply(first, new Map()).set(path, `${first.writes[0].content}// my note\n`);
    const plan = expectPlan(planDeploy(project(), settings(), disk, first.generatedPaths));
    expect(plan.writes.find((entry) => entry.path === path)?.action).toBe("conflict");
    expect(plan.warnings.join(" ")).toMatch(/edited by hand/);
    expect(describeDeploy(plan)).toMatch(/1 waiting for your choice/);
    const overwritten = expectPlan(planDeploy(project(), settings(), disk, first.generatedPaths, [path]));
    expect(overwritten.writes.find((entry) => entry.path === path)?.action).toBe("update");
  });

  it("warns about duplicate OpMode names, missing constants, and missing libraries", () => {
    const files = plainSdk();
    files.set(`${JAVA}/BlueBasket.java`, "package org.firstinspires.ftc.teamcode;\n@Autonomous(name = \"Blue Basket\")\npublic class Old extends LinearOpMode {}\n");
    const inspection = inspectFtcProject({ files });
    const plan = expectPlan(planDeploy(project(), settings(), new Map(), [], [], inspection));
    const text = plan.warnings.join("\n");
    expect(text).toMatch(/already has an OpMode named "Blue Basket"/);
    expect(text).toMatch(/No class org\.firstinspires\.ftc\.teamcode\.pedro\.Constants/);
    expect(text).toMatch(/missing Pedro Pathing, Ivy commands/);
  });

  it("never plans to remove files outside TeamCode sources, and reports invalid settings", () => {
    const outside = new Map([["TeamCode/build.gradle", "x"], ["../escape.java", "x"]]);
    const plan = expectPlan(planDeploy(project(), settings(), outside, ["TeamCode/build.gradle", "../escape.java", `${JAVA}/../../x.java`]));
    expect(plan.removals).toEqual([]);
    const invalid = planDeploy(project(), settings({ javaPackage: "not a package" }), new Map());
    expect(invalid.ok).toBe(false);
  });

  it("uses the project's constants class when the default one is absent", () => {
    const files = plainSdk();
    files.set(`${JAVA}/drive/RobotConstants.java`, "package org.firstinspires.ftc.teamcode.drive;\npublic class RobotConstants {\n  public static Follower create(HardwareMap hardwareMap) { return null; }\n}\n");
    const inspection = inspectFtcProject({ files });
    const defaults = defaultDeploySettings(project(), inspection);
    expect(defaults.constantsClass).toBe("org.firstinspires.ftc.teamcode.drive.RobotConstants");
    const result = generateJava(project(), { constantsClass: defaults.constantsClass });
    expect(result.ok && result.files.some((file) => file.content.includes("RobotConstants.create(hardwareMap)"))).toBe(true);
  });
});
