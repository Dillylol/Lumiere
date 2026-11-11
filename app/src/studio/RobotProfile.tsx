import {
  DRIVE_MOTOR_POSITIONS, DRIVE_ROLES, ENCODER_ROLES, ROBOT_LIMITS, SIZING_CUBE_INCHES, localizerLabel, pedroDevices, pedroRoleLabel, pedroRoleType,
  type DriveMotorPosition, type LocalizerDevice, type OwnedDevice, type Project, type RobotProfile,
} from "../core";
import { HardwareList, typeLabel } from "./HardwareList";
import { NumberField } from "./NumberField";

const POSITION_LABELS: Record<DriveMotorPosition, string> = { frontLeft: "Front left", frontRight: "Front right", backLeft: "Back left", backRight: "Back right" };
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
type Field = { key: keyof typeof ROBOT_LIMITS; label: string; unit: string };
const OWN_FIELDS: Field[] = [
  { key: "widthInches", label: "Width", unit: "in" },
  { key: "lengthInches", label: "Length", unit: "in" },
  { key: "acceleration", label: "Acceleration", unit: "in/s²" },
  { key: "turnRateDeg", label: "Turn rate", unit: "°/s" },
];
const PEDRO_FIELDS: Field[] = [
  { key: "maxForwardVelocity", label: "Forward speed", unit: "in/s" },
  { key: "maxStrafeVelocity", label: "Strafe speed", unit: "in/s" },
  { key: "forwardDeceleration", label: "Forward coast deceleration", unit: "in/s²" },
  { key: "strafeDeceleration", label: "Strafe coast deceleration", unit: "in/s²" },
];

/** A localizer device's row: the constants' details when the project read them. */
function localizerDetails(robot: RobotProfile, device: OwnedDevice): LocalizerDevice | undefined {
  return device.source === "constants" ? robot.localizer?.devices?.find((item) => item.role === device.role && item.name === device.name) : undefined;
}

function when(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * The robot as the project knows it: the size and motion limits that place it on the field and
 * time its paths, the drive motors and localizer from the team's Pedro constants, and the hardware
 * the robot itself reported.
 */
export function RobotProfilePanel({ project, onChange, linked }: { project: Project; onChange: (project: Project) => void; linked: boolean }) {
  const robot = project.robot;
  const synced = linked && robot.constants !== undefined;
  const scan = robot.scan;
  const configured = scan ? new Map(scan.devices.map((device) => [device.name, device.type])) : undefined;
  const pedro = pedroDevices(robot);
  const localizerKind = robot.localizer?.kind ?? scan?.pedro?.localizer ?? undefined;
  const localizerDevices = pedro.filter((device) => !DRIVE_ROLES.has(device.role));
  const set = (key: keyof RobotProfile, value: number) => onChange({ ...project, robot: { ...robot, [key]: value } });
  const status = (name: string, expected?: string) => {
    if (!configured) return "Not scanned";
    const type = configured.get(name);
    if (type === undefined) return "Missing";
    return expected && type !== expected ? `Configured as ${typeLabel(type).toLowerCase()}` : "Configured";
  };
  const fileName = robot.constants?.file.split("/").slice(-2).join("/");
  const field = ({ key, label, unit }: Field) => <NumberField key={key} label={`${label} (${unit})`} value={robot[key]}
    min={ROBOT_LIMITS[key].min} max={ROBOT_LIMITS[key].max} onChange={(value) => set(key, value)}/>;

  return <section className="robot-profile" aria-labelledby="robot-profile-heading">
    <div className="section-title">
      <div>
        <h2 id="robot-profile-heading">Robot profile</h2>
        <p>The field and path timing use these values.</p>
      </div>
      <span className={`chip${synced ? "" : " chip-muted"}`} role="status">
        {synced ? `Synced from ${fileName}${robot.constants!.tuned === false ? " · untuned" : robot.constants!.tuned ? " · tuned" : ""}`
          : linked ? "Reading Pedro constants…" : "Not linked to Pedro constants"}
      </span>
    </div>

    <h3>Size and handling</h3>
    <div className="form-grid">{OWN_FIELDS.map(field)}</div>
    {(robot.widthInches > SIZING_CUBE_INCHES || robot.lengthInches > SIZING_CUBE_INCHES) &&
      <p className="profile-note" role="note">Larger than the {SIZING_CUBE_INCHES}-inch starting size.</p>}

    <h3>Pedro speeds</h3>
    {synced ? <>
      <dl className="stream-values profile-values">
        {PEDRO_FIELDS.map(({ key, label, unit }) => <div key={key}><dt>{label}</dt><dd>{robot[key]} {unit}</dd></div>)}
      </dl>
      <p className="profile-note">From <code>{fileName}</code>{robot.constants!.readAt ? `, last changed ${when(robot.constants!.readAt)}` : ""}. Edit them there, or paste AutoTune results in Code.</p>
    </> : <>
      <div className="form-grid">{PEDRO_FIELDS.map(field)}</div>
      <p className="profile-note">{linked ? "These follow the linked project's Pedro constants once they are read." : "Link your FTC SDK project in the desktop app to read these from its Pedro constants."}</p>
    </>}

    {robot.drivetrain && <>
      <h3>Drive motors</h3>
      <table>
        <thead><tr><th scope="col">Wheel</th><th scope="col">Device</th><th scope="col">Direction</th><th scope="col">On the robot</th></tr></thead>
        <tbody>{DRIVE_MOTOR_POSITIONS.map((position) => {
          const motor = robot.drivetrain![position];
          return <tr key={position}><td>{POSITION_LABELS[position]}</td><td>{motor.name}</td><td>{motor.reversed ? "Reversed" : "Forward"}</td><td>{status(motor.name)}</td></tr>;
        })}</tbody>
      </table>
    </>}

    {localizerKind && <>
      <h3>Localizer</h3>
      <dl className="stream-values profile-values">
        <div><dt>Type</dt><dd>{localizerLabel(localizerKind)}</dd></div>
        {robot.localizer?.xPodOffset !== undefined && <div><dt>Pod offsets</dt><dd>x {robot.localizer.xPodOffset} in, y {robot.localizer.yPodOffset ?? 0} in</dd></div>}
      </dl>
      {localizerDevices.length > 0 && <table aria-label="Localizer devices">
        <thead><tr><th scope="col">Role</th><th scope="col">Device</th><th scope="col">Direction</th><th scope="col">Inches per tick</th><th scope="col">On the robot</th></tr></thead>
        <tbody>{localizerDevices.map((device) => {
          const details = localizerDetails(robot, device);
          const wheel = ENCODER_ROLES.has(device.role);
          return <tr key={`${device.role}\0${device.name}`}>
            <td>{capitalized(pedroRoleLabel(device.role))}{device.source === "robot" ? " (reported by the robot)" : ""}</td>
            <td>{device.name}</td>
            <td>{wheel && details?.reversed !== undefined ? (details.reversed ? "Reversed" : "Forward") : "—"}</td>
            <td>{wheel && details?.inchesPerTick !== undefined ? details.inchesPerTick : "—"}</td>
            <td>{status(device.name, pedroRoleType(device.role))}</td>
          </tr>;
        })}</tbody>
      </table>}
    </>}

    <h3>Robot hardware</h3>
    <HardwareList project={project} onChange={onChange}/>
    {scan && <p className="profile-note">
      The robot's configuration last changed {when(scan.scannedAt)}.
      {scan.pedro && <> The robot reads Pedro Pathing's devices from <code>{scan.pedro.constants.split(".").slice(-2).join(".")}</code>.</>}
    </p>}
  </section>;
}
