import { describe, expect, it } from "vitest";
import { camelCase, commentText, constantCase, javaNumber, javaString, NameScope, packageSegment, pascalCase } from "./names";
import { checksum, ownershipOf, withHeader } from "./ownership";

describe("Java names", () => {
  it("builds identifiers from display names", () => {
    expect(pascalCase("blue close auto", "Auto")).toBe("BlueCloseAuto");
    expect(pascalCase("2 Specimen", "Auto")).toBe("Auto2Specimen");
    expect(pascalCase("class", "Mechanism")).toBe("ClassMechanism");
    expect(pascalCase("  ", "Auto")).toBe("Auto");
    expect(pascalCase("Brazo élevé", "X")).toBe("BrazoEleve");
    expect(camelCase("To Score", "path")).toBe("toScore");
    expect(camelCase("new", "path")).toBe("newpath");
    expect(camelCase("highBasket", "path")).toBe("highBasket");
    expect(constantCase("High Basket", "STATE")).toBe("HIGH_BASKET");
    expect(constantCase("1st", "STATE")).toBe("STATE1ST");
    expect(packageSegment("Team 12345 Robot", "robot")).toBe("team12345robot");
    expect(packageSegment("2025", "robot")).toBe("robot2025");
  });

  it("gives out unique names case-insensitively", () => {
    const scope = new NameScope(["Pose"]);
    expect(scope.claim("pose")).toBe("pose2");
    expect(scope.claim("Claw")).toBe("Claw");
    expect(scope.claim("claw")).toBe("claw2");
  });

  it("writes safe literals and comments", () => {
    expect(javaString('Say "hi"\\ now\n' + String.fromCharCode(1))).toBe('"Say \\"hi\\"\\\\ now\\n\\u0001"');
    expect(javaNumber(36)).toBe("36");
    expect(javaNumber(-0.333333333)).toBe("-0.333333");
    expect(javaNumber(0.1 + 0.2)).toBe("0.3");
    expect(javaNumber(-0)).toBe("0");
    expect(javaNumber(1e-12)).toBe("0");
    expect(() => javaNumber(Number.NaN)).toThrow();
    expect(commentText("ends */ here\nand more")).toBe("ends * / here and more");
  });
});

describe("generated file ownership", () => {
  it("detects edits, removed headers, and Windows line endings", () => {
    const content = withHeader("class A {}\n", "Robot", "App");
    expect(ownershipOf(content)).toBe("generated");
    expect(ownershipOf(content.replace(/\n/g, "\r\n"))).toBe("generated");
    expect(ownershipOf(content.replace("class A", "class B"))).toBe("modified");
    expect(ownershipOf(content.split("\n").slice(2).join("\n"))).toBe("team");
    expect(ownershipOf(content.replace(/checksum: [0-9a-f]+/, "checksum: nope"))).toBe("modified");
    expect(checksum("")).toBe("cbf29ce484222325");
    expect(checksum("a")).not.toBe(checksum("b"));
  });

  it("keeps the project name on one line", () => {
    expect(withHeader("x\n", "Line\nBreak", "App").split("\n")[0]).toContain('"Line Break"');
  });
});
