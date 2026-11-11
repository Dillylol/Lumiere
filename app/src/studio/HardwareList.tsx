import { Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import {
  DEVICE_KINDS, ENCODER_ROLES, deviceKindLabel, deviceUses, hardwareEntry, hardwareList, isDeviceKind, pedroDevices, pedroRoleLabel, useOutputs,
  withHardware, withoutHardware, type DeviceKind, type HardwareDevice, type Project,
} from "../core";
import { NumberField } from "./NumberField";

const KIND_LABELS: Record<string, string> = {
  motor: "Motor", servo: "Servo", crservo: "Continuous servo", imu: "IMU", voltage: "Voltage sensor",
  pinpoint: "goBILDA Pinpoint", otos: "SparkFun OTOS", octoquad: "OctoQuad", camera: "Camera", digital: "Digital channel",
  touch: "Touch sensor", color: "Color sensor", distance: "Distance sensor", analog: "Analog input",
};
/** A manifest type in words, such as "Continuous servo". */
export const typeLabel = (type: string) => KIND_LABELS[type] ?? `${type} (custom driver)`;
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Every encoder target the project sends a device, to start its travel range from. */
function targetsOf(project: Project, name: string): number[] {
  return (deviceUses(project).get(name) ?? []).flatMap(useOutputs).flatMap((output) => (output.kind === "target" ? [output.ticks] : []));
}

/** A starting travel range: every target, with some room either side. */
function defaultTravel(targets: number[]) {
  const low = Math.min(0, ...targets), high = Math.max(0, ...targets), room = Math.max(100, Math.round((high - low) * 0.1));
  return { minTicks: low - room, maxTicks: high + room };
}

/**
 * Chooses a device from the robot's hardware list, of one kind when `kind` is set. Once the robot has been
 * scanned, only the devices it reported (and any added by name) can be chosen; before that, a name can be
 * typed, with the known devices suggested. `exclude` leaves out devices that are taken elsewhere.
 */
export function DevicePicker({ project, label, kind, value, onChange, exclude = [] }: {
  project: Project; label: string; kind?: DeviceKind; value: string; exclude?: string[];
  onChange: (name: string, kind: DeviceKind | undefined) => void;
}) {
  const listId = useId();
  const current = value.trim();
  const options = hardwareList(project).filter((device) => (!kind || device.kind === kind) && (device.name === current || !exclude.includes(device.name)));
  const describe = (device: HardwareDevice) => (kind ? device.name : `${device.name} (${deviceKindLabel(device.kind)})`);
  const pick = (name: string) => onChange(name, options.find((device) => device.name === name.trim())?.kind);
  const what = kind ? deviceKindLabel(kind) : "device";
  if (project.robot.scan) {
    return <label>{label}
      <select value={current} onChange={(event) => pick(event.target.value)}>
        <option value="">{options.length ? `Choose a ${what}` : `No ${what}s on the robot`}</option>
        {current && !options.some((device) => device.name === current) && <option value={current}>{current} (not on the robot)</option>}
        {options.map((device) => <option key={device.name} value={device.name}>{describe(device)}</option>)}
      </select>
    </label>;
  }
  return <label>{label}
    <input list={listId} value={value} placeholder="Name in the robot's configuration" onChange={(event) => pick(event.target.value)}/>
    <datalist id={listId}>{options.map((device) => <option key={device.name} value={device.name}>{describe(device)}</option>)}</datalist>
  </label>;
}

/**
 * The robot's motors, servos and continuous servos, with each one's settings: direction, power limit and
 * travel range. Every mechanism and action that uses a device follows them, in deployed code and in
 * Lumière Live. Sensors and Pedro Pathing's devices are listed after, as the robot reported them.
 */
export function HardwareList({ project, onChange }: { project: Project; onChange: (project: Project) => void }) {
  const robot = project.robot;
  const list = hardwareList(project);
  const uses = deviceUses(project);
  const pedro = pedroDevices(robot);
  const configured = robot.scan ? new Map(robot.scan.devices.map((device) => [device.name, device.type])) : undefined;
  const listed = new Set(list.map((device) => device.name));
  const others = robot.scan?.devices.filter((device) => !listed.has(device.name)) ?? [];
  const set = (device: HardwareDevice) => onChange({ ...project, robot: withHardware(robot, device) });
  const status = (device: HardwareDevice) => {
    if (!configured) return "Not scanned";
    const type = configured.get(device.name);
    if (type === undefined) return "Missing";
    return type === device.kind ? "Configured" : `Configured as ${typeLabel(type).toLowerCase()}`;
  };
  const usedBy = (name: string) => {
    const parts: string[] = [];
    const named = uses.get(name) ?? [];
    for (const use of named) if ("subsystem" in use && !parts.includes(use.subsystem.name || "Mechanism")) parts.push(use.subsystem.name || "Mechanism");
    const actions = named.filter((use) => "step" in use).length;
    if (actions) parts.push(actions === 1 ? "1 action" : `${actions} actions`);
    for (const owned of pedro) if (owned.name === name) parts.push(`${capitalized(pedroRoleLabel(owned.role))} (Pedro Pathing)`);
    return parts.join(", ") || "—";
  };

  return <>
    {list.length > 0 ? <div className="table-scroll">
      <table className="hardware-table" aria-label="Robot hardware">
        <thead><tr>
          <th scope="col">Device</th><th scope="col">Type</th><th scope="col">Used by</th><th scope="col">Reversed</th>
          <th scope="col">Power limit</th><th scope="col">Travel (ticks)</th><th scope="col">On the robot</th><th scope="col"><span className="sr-only">Remove</span></th>
        </tr></thead>
        <tbody>{list.map((device) => {
          const entry = hardwareEntry(robot, device.name);
          const used = uses.has(device.name);
          const targets = device.kind === "motor" ? targetsOf(project, device.name) : [];
          const wheel = pedro.find((owned) => owned.name === device.name && ENCODER_ROLES.has(owned.role));
          return <tr key={device.name}>
            <th scope="row">{device.name}</th>
            <td>{typeLabel(device.kind)}</td>
            <td>{usedBy(device.name)}</td>
            <td><input type="checkbox" aria-label={`${device.name} reversed`} checked={device.reversed} onChange={(event) => set({ ...device, reversed: event.target.checked })}/></td>
            <td>{device.kind === "servo" ? "—" : <NumberField label={`${device.name} power limit`} hideLabel value={device.powerLimit ?? 1} min={0.05} max={1} step={0.05}
              onChange={(limit) => { const { powerLimit: _unset, ...rest } = device; set(limit >= 1 ? rest : { ...rest, powerLimit: limit }); }}/>}</td>
            <td>{device.kind === "motor" && (targets.length > 0 || device.travel) ? <div className="travel-cell">
              <label className="check"><input type="checkbox" checked={!!device.travel}
                onChange={(event) => { const { travel: _unset, ...rest } = device; set(event.target.checked ? { ...rest, travel: defaultTravel(targets) } : rest); }}/>Limit</label>
              {device.travel && <>
                <NumberField label={`${device.name} lowest ticks`} hideLabel integer min={-1_000_000} max={1_000_000} value={device.travel.minTicks}
                  onChange={(minTicks) => set({ ...device, travel: { ...device.travel!, minTicks } })}/>
                <span aria-hidden="true">to</span>
                <NumberField label={`${device.name} highest ticks`} hideLabel integer min={-1_000_000} max={1_000_000} value={device.travel.maxTicks}
                  onChange={(maxTicks) => set({ ...device, travel: { ...device.travel!, maxTicks } })}/>
              </>}
            </div> : "—"}{wheel && <small className="cell-note">Pedro Pathing reads its {pedroRoleLabel(wheel.role)} on this port, so give it power, not targets.</small>}</td>
            <td>{status(device)}</td>
            <td>{entry && !used && !configured?.has(device.name) &&
              <button className="icon-button" aria-label={`Remove ${device.name}`} onClick={() => onChange({ ...project, robot: withoutHardware(robot, device.name) })}><Trash2/></button>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div> : <p className="profile-note">{robot.scan
      ? "The robot reported no motors or servos besides Pedro Pathing's. Add them to its configuration and connect again, or add them by name below."
      : "No motors or servos yet. Connect to the robot from Pathing → Robot to read its configuration, or add devices by name below."}</p>}
    <AddDevice project={project} taken={listed} onAdd={set}/>
    {others.length > 0 && <>
      <h4>Sensors and Pedro Pathing's devices</h4>
      <div className="table-scroll"><table aria-label="Other devices">
        <thead><tr><th scope="col">Device</th><th scope="col">Type</th><th scope="col">Used by</th></tr></thead>
        <tbody>{others.map((device) => <tr key={`${device.name}\0${device.type}`}>
          <th scope="row">{device.name}</th><td>{typeLabel(device.type)}</td>
          <td>{usedBy(device.name) === "—" ? (isDeviceKind(device.type) ? "—" : "Listed only") : usedBy(device.name)}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
    <p className="profile-note">
      {robot.scan ? <>The robot's configuration, as it last reported it. Lumière lists sensors, but does nothing with them yet.</>
        : <>The robot hasn't been scanned, so these are the devices the project names. Connect to the robot to check them against its configuration.</>}
      {" "}A power limit cuts every power the device is given, in deployed code and in Lumière Live.
    </p>
  </>;
}

/** Adds a device by name: for a robot that hasn't been scanned, or a device it hasn't reported yet. */
function AddDevice({ project, taken, onAdd }: { project: Project; taken: Set<string>; onAdd: (device: HardwareDevice) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DeviceKind>("motor");
  const trimmed = name.trim();
  const problem = !trimmed ? null : taken.has(trimmed) ? `"${trimmed}" is already in the list.` : trimmed.length > 60 ? "Use at most 60 characters." : null;
  return <form className="add-device" aria-label="Add a device" onSubmit={(event) => {
    event.preventDefault();
    if (!trimmed || problem) return;
    onAdd({ name: trimmed, kind, reversed: false });
    setName("");
  }}>
    <label>{project.robot.scan ? "Add a device the robot hasn't reported" : "Add a device by name"}
      <input value={name} placeholder="Name in the robot's configuration" aria-invalid={problem ? true : undefined} onChange={(event) => setName(event.target.value)}/>
    </label>
    <label>Type
      <select value={kind} onChange={(event) => setKind(event.target.value as DeviceKind)}>
        {DEVICE_KINDS.map((item) => <option key={item} value={item}>{typeLabel(item)}</option>)}
      </select>
    </label>
    <button type="submit" disabled={!trimmed || !!problem}><Plus/>Add</button>
    {problem && <small role="alert">{problem}</small>}
  </form>;
}
