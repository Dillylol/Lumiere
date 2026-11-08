import type { RobotProfile } from "./types";

/** The robot's size and motion limits: everything that changes how it drives, without where the values came from. */
export type PhysicalRobot = Pick<RobotProfile,
  "widthInches" | "lengthInches" | "maxForwardVelocity" | "maxStrafeVelocity"
  | "forwardDeceleration" | "strafeDeceleration" | "acceleration" | "turnRateDeg">;

export function physicalRobot(robot: RobotProfile): PhysicalRobot {
  const { widthInches, lengthInches, maxForwardVelocity, maxStrafeVelocity, forwardDeceleration, strafeDeceleration, acceleration, turnRateDeg } = robot;
  return { widthInches, lengthInches, maxForwardVelocity, maxStrafeVelocity, forwardDeceleration, strafeDeceleration, acceleration, turnRateDeg };
}
