import { Plus, Trash2 } from "lucide-react";
import {
  DEVICE_KINDS, createDevice, createState, createSubsystem, defaultOutput, hardwareList, limitPower, powerLimitOf,
  type Device, type DeviceKind, type Output, type Project, type Subsystem,
} from "../core";
import { DevicePicker, typeLabel } from "./HardwareList";
import { NumberField } from "./NumberField";

/** Devices that no mechanism has yet, from the hardware list. */
function freeDevices(project: Project) {
  const taken = new Set(project.subsystems.flatMap((subsystem) => subsystem.devices.map((device) => device.name.trim())));
  return hardwareList(project).filter((device) => !taken.has(device.name));
}

/**
 * A power input that says when the device's power limit will cut what was typed. `label` names the field;
 * `deviceName` finds the limit in the hardware list.
 */
export function PowerField({ project, deviceName, label, value, min = -1, onChange }: {
  project: Project; deviceName: string; label: string; value: number; min?: number; onChange: (value: number) => void;
}) {
  const limit = powerLimitOf(project.robot, deviceName);
  return <div className="power-field">
    <NumberField label={label} min={min} max={1} step={0.05} value={value} onChange={onChange}/>
    {Math.abs(value) > limit && <small role="note">Runs at {limitPower(value, limit)}: {deviceName.trim()}'s power limit.</small>}
  </div>;
}

/** The project's mechanisms: optional named groups of devices from the hardware list, with states that set them. */
export function Mechanisms({ project, onChange }: { project: Project; onChange: (project: Project) => void }) {
  const update = (next: Subsystem) => onChange({ ...project, subsystems: project.subsystems.map((item) => (item.id === next.id ? next : item)) });
  const add = () => {
    // A new mechanism starts with a free device (a servo when there is one) and a starting state, so it can be used at once.
    const free = freeDevices(project);
    const pick = free.find((device) => device.kind === "servo") ?? free[0] ?? { name: "claw", kind: "servo" as const };
    const subsystem = createSubsystem(`Mechanism ${project.subsystems.length + 1}`);
    const device = createDevice(pick.name, pick.kind);
    subsystem.devices.push(device);
    const safe = createState("Safe");
    safe.outputs[device.id] = defaultOutput(device.kind);
    subsystem.states.push(safe);
    subsystem.initialStateId = safe.id;
    onChange({ ...project, subsystems: [...project.subsystems, subsystem] });
  };
  return <section className="mechanisms">
    <div className="section-title">
      <div>
        <h2>Mechanisms</h2>
        <p>Optional. A mechanism groups devices from the hardware list into named states, such as Open and Closed, for actions and buttons to set.</p>
      </div>
      <button onClick={add}><Plus/>Add mechanism</button>
    </div>
    {project.subsystems.map((subsystem) => <MechanismEditor key={subsystem.id} project={project} subsystem={subsystem} onChange={update}
      onDelete={() => onChange({ ...project, subsystems: project.subsystems.filter((item) => item.id !== subsystem.id) })}/>)}
  </section>;
}

function MechanismEditor({ project, subsystem: s, onChange, onDelete }: {
  project: Project; subsystem: Subsystem; onChange: (subsystem: Subsystem) => void; onDelete: () => void;
}) {
  const otherMechanisms = project.subsystems.filter((item) => item.id !== s.id).flatMap((item) => item.devices.map((device) => device.name.trim()));
  const setDevice = (device: Device, name: string, kind: DeviceKind | undefined) => {
    const next = kind ?? device.kind;
    onChange({
      ...s,
      devices: s.devices.map((item) => (item.id === device.id ? { ...item, name, kind: next } : item)),
      // Another kind of device takes other outputs, so its states start again from the default.
      states: next === device.kind ? s.states : s.states.map((state) => ({ ...state, outputs: { ...state.outputs, [device.id]: defaultOutput(next) } })),
    });
  };
  const removeDevice = (device: Device) => onChange({
    ...s,
    devices: s.devices.filter((item) => item.id !== device.id),
    states: s.states.map((state) => ({ ...state, outputs: Object.fromEntries(Object.entries(state.outputs).filter(([id]) => id !== device.id)) })),
  });
  const addDevice = () => {
    const free = freeDevices(project)[0];
    onChange({ ...s, devices: [...s.devices, createDevice(free?.name ?? "", free?.kind ?? "motor")] });
  };
  const setState = (stateId: string, change: (outputs: Record<string, Output>) => Record<string, Output>) =>
    onChange({ ...s, states: s.states.map((state) => (state.id === stateId ? { ...state, outputs: change(state.outputs) } : state)) });

  return <article className="mechanism">
    <div className="inline-actions">
      <label>Mechanism name<input value={s.name} onChange={(event) => onChange({ ...s, name: event.target.value })}/></label>
      <button aria-label={`Delete ${s.name}`} onClick={onDelete}><Trash2/></button>
    </div>
    <h3>Devices</h3>
    {s.devices.map((device) => <div className="mechanism-device" key={device.id}>
      <DevicePicker project={project} label="Device" value={device.name}
        exclude={[...otherMechanisms, ...s.devices.filter((item) => item.id !== device.id).map((item) => item.name.trim())]}
        onChange={(name, kind) => setDevice(device, name, kind)}/>
      {project.robot.scan
        ? <p className="device-kind"><span>Type</span>{typeLabel(device.kind)}</p>
        : <label>Device type
          <select value={device.kind} onChange={(event) => setDevice(device, device.name, event.target.value as DeviceKind)}>
            {DEVICE_KINDS.map((kind) => <option key={kind} value={kind}>{typeLabel(kind)}</option>)}
          </select>
        </label>}
      <button aria-label={`Remove ${device.name.trim() || "this device"} from ${s.name}`} onClick={() => removeDevice(device)}><Trash2/></button>
    </div>)}
    <button onClick={addDevice}><Plus/>Add device</button>
    <p className="profile-note">Each device's direction, power limit and travel range are in the hardware list above.</p>

    <h3>States</h3>
    {s.states.map((state) => <div className="mechanism-state" key={state.id}>
      <label>State name<input value={state.name} onChange={(event) => onChange({ ...s, states: s.states.map((item) => (item.id === state.id ? { ...item, name: event.target.value } : item)) })}/></label>
      {s.devices.map((device) => {
        const out = state.outputs[device.id];
        const set = (output: Output) => setState(state.id, (outputs) => ({ ...outputs, [device.id]: output }));
        const name = device.name.trim() || "Device";
        return <div key={device.id}>
          {device.kind === "motor" && <label>{name} control
            <select value={out?.kind ?? "power"} onChange={(event) => set(event.target.value === "target" ? { kind: "target", ticks: 0, power: 0.5 } : { kind: "power", value: 0 })}>
              <option value="power">Power</option><option value="target">Encoder target</option>
            </select>
          </label>}
          {out?.kind === "target" ? <>
            <NumberField label="Target ticks" value={out.ticks} integer min={-1_000_000} max={1_000_000} onChange={(ticks) => set({ ...out, ticks })}/>
            <PowerField project={project} deviceName={device.name} label="Target power" value={out.power} min={0.01} onChange={(power) => set({ ...out, power })}/>
          </> : device.kind === "servo"
            ? <NumberField label={`${name} position`} min={0} max={1} step={0.05} value={out?.value ?? 0} onChange={(value) => set({ kind: "position", value })}/>
            : <PowerField project={project} deviceName={device.name} label={`${name} power`} value={out?.value ?? 0} onChange={(value) => set({ kind: "power", value })}/>}
        </div>;
      })}
      <button aria-label={`Delete state ${state.name}`} onClick={() => onChange({ ...s, states: s.states.filter((item) => item.id !== state.id), initialStateId: s.initialStateId === state.id ? null : s.initialStateId })}><Trash2/></button>
    </div>)}
    <button onClick={() => onChange({ ...s, states: [...s.states, createState(`State ${s.states.length + 1}`)] })}><Plus/>Add state</button>
    <label>Initial state
      <select value={s.initialStateId ?? ""} onChange={(event) => onChange({ ...s, initialStateId: event.target.value || null })}>
        <option value="">Leave unchanged</option>
        {s.states.map((state) => <option key={state.id} value={state.id}>{state.name}</option>)}
      </select>
    </label>
  </article>;
}
