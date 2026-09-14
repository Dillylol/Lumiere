import { describe, expect, it } from "vitest";
import { findOpModes } from "./opModes";
import { importsOf, maskJava, packageOf, unescapeJavaString } from "./source";
import { applyTunerOutput, parseTunerOutput, setTuned, updateTuningLocalizer } from "./tuning";

// The quickstart overlay is outside the app folder, so it is read from disk rather than imported.
type NodeFs = { readFileSync(path: string, encoding: "utf8"): string };
const nodeFs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as NodeFs;
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const overlayFile = (name: string) => {
  const folder = name === "Constants.java" || name === "Tuning.java" ? "pedro" : "examples";
  return nodeFs.readFileSync(`${cwd}/../quickstart/overlay/TeamCode/src/main/java/org/firstinspires/ftc/teamcode/${folder}/${name}`, "utf8");
};
const lines = (...parts: string[]) => parts.join("\n");

describe("Java source helpers", () => {
  it("masks comments and literals without moving offsets", () => {
    const source = lines('String a = "@TeleOp // not a comment"; // @Autonomous', "char q = '\\''; /* class Fake */ int b;", 'String t = """', "class Hidden", '""";');
    const masked = maskJava(source);
    expect(masked).toHaveLength(source.length);
    expect(masked).not.toMatch(/TeleOp|Autonomous|Fake|Hidden/);
    expect(masked).toContain("int b;");
    expect(masked.split("\n")).toHaveLength(source.split("\n").length);
  });

  it("reads packages, imports, and string escapes", () => {
    const source = lines("// package wrong;", "package org.firstinspires.ftc.teamcode.auto;", "import java.util.List;", "import static java.lang.Math.max;");
    expect(packageOf(source)).toBe("org.firstinspires.ftc.teamcode.auto");
    expect(importsOf(source)).toEqual(["java.util.List"]);
    expect(unescapeJavaString('Blue \\"Left\\" \\u00e9\\t')).toBe('Blue "Left" é\t');
  });
});

describe("findOpModes", () => {
  it("excludes declarations the SDK cannot register", () => {
    expect(findOpModes('@TeleOp public class Plain {} @TeleOp class Hidden extends OpMode {} @TeleOp @Autonomous public class Both extends OpMode {} public class Outer { @TeleOp public class Inner extends OpMode {} } @Autonomous public abstract class Base extends LinearOpMode {}')).toEqual([]);
  });
  it("finds the quickstart examples", () => {
    const auto = findOpModes(overlayFile("ExampleAuto.java"));
    const teleOp = findOpModes(overlayFile("ExampleTeleOp.java"));
    expect(auto).toMatchObject([{ className: "ExampleAuto", name: "Example Auto", flavor: "autonomous", disabled: false }]);
    expect(auto[0].qualifiedName).toBe("org.firstinspires.ftc.teamcode.examples.ExampleAuto");
    expect(teleOp).toMatchObject([{ className: "ExampleTeleOp", name: "Example TeleOp", flavor: "teleop" }]);
    expect(findOpModes(overlayFile("Constants.java"))).toEqual([]);
  });

  it("follows the SDK's naming rules and ignores look-alikes", () => {
    const source = lines(
      "package org.firstinspires.ftc.teamcode;",
      "",
      "/** @TeleOp(name = \"In a comment\") class Nope */",
      "@Disabled",
      "@com.qualcomm.robotcore.eventloop.opmode.Autonomous(group = \"Blue\", preselectTeleOp = \"Drive\")",
      "@SuppressWarnings({\"unused\"})",
      "public class BlueLeft extends LinearOpMode {",
      "    String label = \"@TeleOp\";",
      "    @TeleOp(name = \"Nested \\\"Drive\\\"\")",
      "    public static class Drive extends OpMode { }",
      "    void method() { class Local {} }",
      "}",
      "",
      "class Helper {}",
    );
    expect(findOpModes(source)).toEqual([
      {
        className: "BlueLeft",
        qualifiedName: "org.firstinspires.ftc.teamcode.BlueLeft",
        name: "BlueLeft",
        group: "Blue",
        flavor: "autonomous",
        disabled: true,
        preselectTeleOp: "Drive",
        line: 5,
      },
      {
        className: "Drive",
        qualifiedName: "org.firstinspires.ftc.teamcode.BlueLeft$Drive",
        name: 'Nested "Drive"',
        group: "",
        flavor: "teleop",
        disabled: false,
        line: 9,
      },
    ]);
  });
});

// Output in the exact shape the AutoTune procedures print (pedro/procedures/*Tuner.java).
const mecanumOutput = lines(
  "public static MecanumConfig drivetrainConfig = new MecanumConfig(c -> {",
  '    c.frontLeftName.set("fl");',
  '    c.frontRightName.set("fr");',
  '    c.backLeftName.set("bl");',
  '    c.backRightName.set("br");',
  "    c.frontLeftDirection.set(DcMotorSimple.Direction.FORWARD);",
  "    c.frontRightDirection.set(DcMotorSimple.Direction.REVERSE);",
  "    c.backLeftDirection.set(DcMotorSimple.Direction.FORWARD);",
  "    c.backRightDirection.set(DcMotorSimple.Direction.REVERSE);",
  "});",
);
const pinpointOutput = lines(
  "public static PinpointConfig localizerConfig = new PinpointConfig(c -> {",
  '    c.name.set("odo");',
  "    c.ticksPerUnit.set(OptionalDouble.of(505.31));",
  "    c.xPodOffset.set(-3.25);",
  "    c.yPodOffset.set(6.5);",
  "    c.xPodDirection.set(GoBildaPinpointDriver.EncoderDirection.REVERSED);",
  "    c.yPodDirection.set(GoBildaPinpointDriver.EncoderDirection.FORWARD);",
  "    c.globalDistanceUnit.set(DistanceUnit.INCH);",
  "    c.offsetUnits.set(DistanceUnit.INCH);",
  "});",
);
const threeWheelOutput = lines(
  "public static ThreeWheelConfig localizerConfig = new ThreeWheelConfig(c -> {",
  '    c.leftEncoderName.set("left_back_drive");',
  '    c.rightEncoderName.set("right_front_drive");',
  '    c.strafeEncoderName.set("right_back_drive");',
  "    c.leftPodY.set(6.1);",
  "    c.rightPodY.set(-6.1);",
  "    c.strafePodX.set(-2.5);",
  "    c.forwardTicksToInches.set(0.0029);",
  "    c.strafeTicksToInches.set(0.0029);",
  "    c.turnTicksToRadians.set(0.0021);",
  "    c.leftEncoderDirection.set(Encoder.REVERSE);",
  "    c.rightEncoderDirection.set(Encoder.FORWARD);",
  "    c.strafeEncoderDirection.set(Encoder.FORWARD);",
  "});",
);

describe("AutoTune output", () => {
  it("parses declarations and ignores surrounding text", () => {
    const pasted = `Paste this into Constants:\n${mecanumOutput}\n\n// done\n${pinpointOutput}`;
    expect(parseTunerOutput(pasted).map(({ type, field }) => `${type} ${field}`)).toEqual(["MecanumConfig drivetrainConfig", "PinpointConfig localizerConfig"]);
    expect(parseTunerOutput(pasted)[0].code).toBe(mecanumOutput);
    expect(() => applyTunerOutput(overlayFile("Constants.java"), "nothing here")).toThrow(/No configuration/);
  });

  it("replaces tuned blocks in the quickstart Constants.java and adds missing imports", () => {
    const constants = overlayFile("Constants.java");
    const result = applyTunerOutput(constants, `${mecanumOutput}\n${pinpointOutput}`);
    expect(result.replaced).toEqual(["drivetrainConfig", "localizerConfig"]);
    expect(result.missing).toEqual([]);
    expect(result.importsAdded).toEqual(["java.util.OptionalDouble"]);
    expect(result.localizerChange).toBeUndefined();
    expect(result.source).toContain('    public static MecanumConfig drivetrainConfig = new MecanumConfig(c -> {\n        c.frontLeftName.set("fl");');
    expect(result.source).toContain("c.ticksPerUnit.set(OptionalDouble.of(505.31));");
    expect(result.source).not.toContain('c.name.set("pinpoint")');
    expect(result.source).toContain("new PinpointLocalizer(hardwareMap, localizerConfig)");
    expect(result.source.match(/foresightConfig = new ForesightConfig/g)).toHaveLength(1);
    // Applying the same output again changes nothing.
    expect(applyTunerOutput(result.source, `${mecanumOutput}\n${pinpointOutput}`).source).toBe(result.source);
  });

  it("switches the localizer in Constants.java and Tuning.java", () => {
    const result = applyTunerOutput(overlayFile("Constants.java"), threeWheelOutput);
    expect(result.localizerChange).toEqual({ from: "PinpointConfig", to: "ThreeWheelConfig" });
    expect(result.source).toContain("new ThreeWheelLocalizer(hardwareMap, localizerConfig)");
    expect(result.source).toContain("import com.pedropathing.revhub.localizers.ThreeWheelConfig;");
    expect(result.source).toContain("import com.pedropathing.revhub.localizers.ThreeWheelLocalizer;");
    expect(result.source).not.toMatch(/import com\.pedropathing\.revhub\.localizers\.Pinpoint/);
    expect(result.importsAdded).toEqual(["com.pedropathing.revhub.localizers.Encoder"]);
    expect(result.notes.join(" ")).toMatch(/Tuning\.java/);
    expect(result.notes.join(" ")).toMatch(/simulator/);

    const tuning = updateTuningLocalizer(overlayFile("Tuning.java"), result.localizerChange!);
    expect(tuning).toContain("new ThreeWheelLocalizer(hardwareMap, Constants.localizerConfig)");
    expect(tuning).toContain("new ThreeWheelTuner()");
    expect(tuning).toContain("import org.firstinspires.ftc.teamcode.pedro.procedures.ThreeWheelTuner;");
    expect(tuning).not.toMatch(/Pinpoint(Localizer|Tuner)/);
  });

  it("reports fields Constants.java does not have and sets TUNED", () => {
    const result = applyTunerOutput(overlayFile("Constants.java"), "public static SwerveConfig swerveConfig = new SwerveConfig(c -> {});");
    expect(result.missing).toEqual(["swerveConfig"]);
    expect(result.source).toBe(overlayFile("Constants.java"));
    expect(setTuned(overlayFile("Constants.java"), true)).toContain("public static final boolean TUNED = true;");
  });
});
