import { describe, expect, it } from "vitest";
import { generateJava, generateJules, parseJules } from "./julesLanguage";

describe("JULES language", () => {
  it("parses supported actions and retains comments", () => {
    const result = parseJules(`# Safe starting move\ndrive.forward(0.4, 800)\nservo.set("claw", 0.5)\nstop()`);
    expect(result.diagnostics).toEqual([]);
    expect(result.ir.actions).toHaveLength(3);
    expect(result.ir.actions[0].leadingComments).toEqual(["Safe starting move"]);
    expect(result.ir.actions[1].args).toMatchObject({ device: "claw", position: 0.5 });
  });

  it("round trips disabled and path actions through source", () => {
    const source = "# Keep this step for later\n# @disabled drive.forward(0.5, 800)\npath.linear(0, 0, 24, 24)";
    const parsed = parseJules(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.ir.actions[0]).toMatchObject({ enabled: false, kind: "drive" });
    expect(parsed.ir.actions[0].leadingComments).toEqual(["Keep this step for later"]);
    expect(parsed.ir.actions[1]).toMatchObject({ kind: "path", args: { mode: "linear", values: "0, 0, 24, 24" } });
    expect(generateJules(parsed.ir)).toBe(source);
  });

  it("accepts Pedro path chain markers without creating fake actions", () => {
    const parsed = parseJules("path.start()\npath.linear(24, 36, 0, 90)\npath.follow()");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.ir.actions).toHaveLength(1);
    expect(parsed.ir.actions[0]).toMatchObject({ kind: "path", args: { mode: "linear", values: "24, 36, 0, 90" } });
  });

  it("reports syntax and unsafe ranges at the source line", () => {
    const result = parseJules(`drive.forward(1.5, 500)\npython.print("no")`);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]).toMatchObject({ line: 1, severity: "error" });
    expect(result.diagnostics[1]).toMatchObject({ line: 2, severity: "error" });
  });

  it("round trips visual actions into deterministic source", () => {
    const source = `# Pause before stopping\nwait(250)\nstop()`;
    const first = parseJules(source);
    const generated = generateJules(first.ir);
    const second = parseJules(generated);
    expect(second.diagnostics).toEqual([]);
    expect(second.ir.actions.map((action) => action.kind)).toEqual(["wait", "stop"]);
    expect(generated).toContain("# Pause before stopping");
  });

  it("generates a readable FTC Java preview", () => {
    const parsed = parseJules(`motor.set("lift", 0.2)\nstop()`);
    const java = generateJava(parsed.ir, "HardwareCheck", "utility");
    expect(java).toContain("public final class HardwareCheck");
    expect(java).toContain('robot.motor("lift").setPower(0.2);');
    expect(java).toContain("robot.stopAll();");
  });
});
