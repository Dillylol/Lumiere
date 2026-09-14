import { describe, expect, it } from "vitest";
import checked from "../../../../fixtures/java-hints.json";
import { javaCompletions } from "./completions";
import { CLASSES, HINTS, SNIPPETS } from "./hints";

const update = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.UPDATE_GOLDEN === "1";

/** Completes at the `|` marker. */
function complete(text: string) {
  const offset = text.indexOf("|");
  return javaCompletions(text.replace("|", ""), offset);
}
const labels = (text: string) => complete(text).items.map((item) => item.label);

const opMode = (body: string) => `package org.firstinspires.ftc.teamcode;

import com.pedropathing.follower.Follower;

public class Auto extends OpMode {
    private Follower follower;
    private DcMotorEx lift;

    @Override
    public void loop() {
        ${body}
    }
}`;

describe("Java hints", () => {
  it("match the file the quickstart CI checks against the real libraries", async () => {
    const expected = { hints: HINTS.map(({ owner, name, kind, params, returns }) => ({ owner, name, kind, params: params.map((param) => param.type), returns })) };
    if (update) {
      const fs = await import(/* @vite-ignore */ ["node", "fs"].join(":"));
      const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
      fs.writeFileSync(`${cwd}/../fixtures/java-hints.json`, `${JSON.stringify(expected, null, 2)}\n`);
      return;
    }
    expect(checked).toEqual(expected);
  });

  it("have unique members, known owners, and usable snippets", () => {
    const owners = new Set(Object.values(CLASSES));
    const keys = new Set<string>();
    for (const hint of HINTS) {
      expect(owners.has(hint.owner), hint.owner).toBe(true);
      const key = `${hint.owner}#${hint.name}(${hint.params.map((param) => param.type).join(",")})`;
      expect(keys.has(key), key).toBe(false);
      keys.add(key);
      expect(hint.summary.endsWith("."), key).toBe(true);
    }
    for (const snippet of SNIPPETS) for (const qualified of snippet.imports) expect(owners.has(qualified), qualified).toBe(true);
  });
});

describe("javaCompletions", () => {
  it("completes members of declared variables, inherited members included", () => {
    expect(labels(opMode("follower.|"))).toEqual(expect.arrayContaining(["update", "follow", "pose", "setPose", "isBusy"]));
    expect(labels(opMode("lift.setP|"))).toEqual(["setPower"]);
    expect(labels(opMode("lift.|"))).toEqual(expect.arrayContaining(["setVelocity", "setMode", "getCurrentPosition", "setDirection"]));
    const setPower = complete(opMode("lift.setP|")).items[0];
    expect(setPower).toMatchObject({ insertText: "setPower(${1:power})", snippet: true, detail: "void setPower(double power)" });
  });

  it("completes OpMode fields, static classes, and call chains", () => {
    expect(labels(opMode("telemetry.add|"))).toEqual(["addData", "addLine"]);
    expect(labels(opMode("gamepad1.aWas|"))).toEqual(["aWasPressed"]);
    expect(labels(opMode("Paths.|"))).toEqual(["line", "curve", "path"]);
    expect(labels(opMode("PoseFactory.degrees().|"))).toEqual(["of"]);
    expect(labels(opMode("Paths.line(a, b).|"))).toEqual(expect.arrayContaining(["heading", "tangent", "linear", "constant"]));
    expect(labels(opMode("PanelsTelemetry.INSTANCE.getTelemetry().|"))).toEqual(["addData", "addLine", "update"]);
    expect(labels(opMode('hardwareMap.get(Servo.class, "claw").|'))).toEqual(expect.arrayContaining(["setPosition", "scaleRange"]));
    expect(labels(opMode("Groups.sequential(a, b).|"))).toEqual(["then", "with", "until"]);
  });

  it("offers classes with imports, OpMode members, locals, and snippets elsewhere", () => {
    const result = complete(opMode("Sche|"));
    expect(result.items.map((item) => item.label)).toEqual(["Scheduler"]);
    expect(result.items[0].imports).toEqual(["com.pedropathing.ivy.Scheduler"]);
    expect(result.from).toBe(opMode("Sche|").indexOf("Sche"));
    expect(complete(opMode("Foll|")).items[0].imports).toEqual([]);
    expect(labels(opMode("tele|"))).toEqual(["TeleOp", "Telemetry", "TelemetryManager", "telemetry"]);
    expect(complete(opMode("tele|")).items[3]).toMatchObject({ kind: "field", detail: "Telemetry telemetry" });
    expect(labels(opMode("lif|"))).toEqual(["lift"]);
    expect(labels("Pedro|")).toEqual(["PedroCommands", "Pedro autonomous"]);
    expect(complete("Pedro|").items[1].imports).toContain("com.pedropathing.ivy.Scheduler");
  });

  it("stays quiet in comments, strings, and unknown receivers", () => {
    expect(complete(opMode("// follower.|")).items).toEqual([]);
    expect(complete(opMode('telemetry.addLine("follower.|')).items).toEqual([]);
    expect(complete(opMode("unknownThing.|")).items).toEqual([]);
  });
});
