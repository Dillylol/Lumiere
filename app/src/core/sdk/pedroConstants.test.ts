import { describe, expect, it } from "vitest";
// The quickstart overlay new FTC projects get; vitest.config.ts lets tests read beside app/.
import quickstart from "../../../../quickstart/overlay/TeamCode/src/main/java/org/firstinspires/ftc/teamcode/pedro/Constants.java?raw";
import { createProject } from "../ir/create";
import { readPedroConstants, syncRobotProfile } from "./pedroConstants";

describe("readPedroConstants", () => {
  it("reads the quickstart's Pedro 3 constants", () => {
    const constants = readPedroConstants(quickstart);
    expect(constants.tuned).toBe(false);
    expect(constants.drivetrain).toEqual({
      frontLeft: { name: "left_front_drive", reversed: true },
      frontRight: { name: "right_front_drive", reversed: false },
      backLeft: { name: "left_back_drive", reversed: true },
      backRight: { name: "right_back_drive", reversed: false },
    });
    expect(constants.localizer).toEqual({ kind: "pinpoint", name: "pinpoint", xPodOffset: 0, yPodOffset: 0 });
    expect(constants.foresight).toEqual({ maxForwardVelocity: 60, maxStrafeVelocity: 50, forwardDeceleration: 40, strafeDeceleration: 50 });
    expect(constants.unreadable).toEqual([]);
  });

  it("follows the lambda's own name, converts pod offsets to inches, and ignores comments", () => {
    const source = `
      import com.pedropathing.revhub.localizers.PinpointConfig;
      public final class Constants {
        public static final boolean TUNED = true;
        // c.frontLeftName.set("commented_out");
        public static MecanumConfig drivetrainConfig = new MecanumConfig(cfg -> {
          cfg.frontLeftName.set("fl"); cfg.frontRightName.set("fr");
          cfg.backLeftName.set("bl"); cfg.backRightName.set("br");
          cfg.frontLeftDirection.set(DcMotorSimple.Direction.REVERSE);
          cfg.frontRightDirection.set(DcMotorSimple.Direction.FORWARD);
          cfg.backLeftDirection.set(Direction.REVERSE);
          cfg.backRightDirection.set(FORWARD);
        });
        public static PinpointConfig localizerConfig = new PinpointConfig(p -> {
          p.name.set("odo");
          p.xPodOffset.set(-84.0);
          p.yPodOffset.set(25.4f);
          p.offsetUnits.set(DistanceUnit.MM);
        });
        public static ForesightConfig foresightConfig = new ForesightConfig(c -> {
          c.maxAchievableForwardVelocity.set(BASE_SPEED * 1.1);
          c.maxAchievableStrafeVelocity.set(55.5);
          c.naturalForwardDeceleration.set(-38.2);
        });
      }`;
    const constants = readPedroConstants(source);
    expect(constants.tuned).toBe(true);
    expect(constants.drivetrain?.frontLeft).toEqual({ name: "fl", reversed: true });
    expect(constants.drivetrain?.backRight).toEqual({ name: "br", reversed: false });
    expect(constants.localizer).toEqual({ kind: "pinpoint", name: "odo", xPodOffset: -3.307, yPodOffset: 1 });
    expect(constants.foresight).toEqual({ maxStrafeVelocity: 55.5, forwardDeceleration: 38.2 });
    expect(constants.unreadable).toEqual(["ForesightConfig.maxAchievableForwardVelocity"]);
  });

  it("recognises another localizer from its import and reports out-of-range values", () => {
    const source = `
      import com.pedropathing.revhub.localizers.OTOSConfig;
      class Constants {
        static OTOSConfig localizerConfig = new OTOSConfig(c -> { c.name.set("sparkfun_otos"); });
        static ForesightConfig foresightConfig = new ForesightConfig(c -> { c.maxAchievableForwardVelocity.set(900.0); });
      }`;
    const constants = readPedroConstants(source);
    expect(constants.tuned).toBeNull();
    expect(constants.drivetrain).toBeNull();
    expect(constants.localizer).toEqual({ kind: "otos", name: "sparkfun_otos" });
    expect(constants.foresight).toEqual({});
    expect(constants.unreadable).toEqual(["ForesightConfig.maxAchievableForwardVelocity (900 is outside 1–200)"]);
  });

  it("leaves the drivetrain out when a motor is not fully described", () => {
    const source = `class Constants { static MecanumConfig d = new MecanumConfig(c -> { c.frontLeftName.set("fl"); }); }`;
    expect(readPedroConstants(source).drivetrain).toBeNull();
  });
});

describe("syncRobotProfile", () => {
  it("applies the constants once and only reports a change when a value changes", () => {
    const robot = createProject("Robot").robot;
    const constants = readPedroConstants(quickstart);
    const file = "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/pedro/Constants.java";
    const first = syncRobotProfile(robot, constants, file, new Date("2026-11-07T10:00:00Z"));
    expect(first?.drivetrain?.frontLeft.name).toBe("left_front_drive");
    expect(first?.constants).toEqual({ file, readAt: "2026-11-07T10:00:00.000Z", tuned: false, unreadable: [] });

    expect(syncRobotProfile(first!, constants, file, new Date("2026-11-07T11:00:00Z"))).toBeNull();

    const faster = { ...constants, foresight: { ...constants.foresight, maxForwardVelocity: 72 } };
    const second = syncRobotProfile(first!, faster, file, new Date("2026-11-07T12:00:00Z"));
    expect(second?.maxForwardVelocity).toBe(72);
    expect(second?.constants?.readAt).toBe("2026-11-07T12:00:00.000Z");
    expect(second?.widthInches).toBe(robot.widthInches);
  });
});
