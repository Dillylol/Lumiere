import { DRIVE_MOTOR_POSITIONS, ROBOT_LIMITS, SIZING_CUBE_INCHES, type DriveMotorPosition, type Project, type RobotProfile } from "../core";
import { NumberField } from "./ProgramEditor";

const POSITION_LABELS: Record<DriveMotorPosition, string> = { frontLeft: "Front left", frontRight: "Front right", backLeft: "Back left", backRight: "Back right" };
const KIND_LABELS: Record<string, string> = {
  motor: "Motor", servo: "Servo", crservo: "Continuous servo", imu: "IMU", voltage: "Voltage sensor",
  pinpoint: "goBILDA Pinpoint", otos: "SparkFun OTOS", camera: "Camera", digital: "Digital input",
  touch: "Touch sensor", color: "Color sensor", distance: "Distance sensor", analog: "Analog input",
};
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

/** What uses each configured device: a drive motor, the localizer, or mechanisms. */
function usesOf(project: Project): Map<string, string[]> {
  const uses = new Map<string, string[]>();
  const add = (name: string, use: string) => uses.set(name, [...(uses.get(name) ?? []), use]);
  const robot = project.robot;
  if (robot.drivetrain) for (const position of DRIVE_MOTOR_POSITIONS) add(robot.drivetrain[position].name, `${POSITION_LABELS[position]} drive`);
  if (robot.localizer?.name) add(robot.localizer.name, "Localizer");
  for (const subsystem of project.subsystems) for (const device of subsystem.devices) add(device.name, subsystem.name || "Mechanism");
  return uses;
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
  const uses = usesOf(project);
  const set = (key: keyof RobotProfile, value: number) => onChange({ ...project, robot: { ...robot, [key]: value } });
  const status = (name: string) => !configured ? "Not scanned" : configured.has(name) ? "Configured" : "Missing";
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

    {robot.localizer && <>
      <h3>Localizer</h3>
      <dl className="stream-values profile-values">
        <div><dt>Type</dt><dd>{robot.localizer.kind === "pinpoint" ? "goBILDA Pinpoint" : robot.localizer.kind.toUpperCase()}</dd></div>
        {robot.localizer.name && <div><dt>Device</dt><dd>{robot.localizer.name} · {status(robot.localizer.name)}</dd></div>}
        {robot.localizer.xPodOffset !== undefined && <div><dt>Pod offsets</dt><dd>x {robot.localizer.xPodOffset} in, y {robot.localizer.yPodOffset ?? 0} in</dd></div>}
      </dl>
    </>}

    <h3>Robot hardware</h3>
    {scan ? <>
      <table>
        <thead><tr><th scope="col">Device</th><th scope="col">Type</th><th scope="col">Used by</th></tr></thead>
        <tbody>{scan.devices.map((device) => <tr key={device.name}>
          <td>{device.name}</td><td>{KIND_LABELS[device.type] ?? device.type}</td><td>{uses.get(device.name)?.join(", ") ?? "—"}</td>
        </tr>)}</tbody>
      </table>
      <p className="profile-note">Read from the robot's configuration {when(scan.scannedAt)}.</p>
    </> : <p className="profile-note">Connect to the robot from Simulate → Robot to read its configured hardware and check it against this project.</p>}
  </section>;
}
