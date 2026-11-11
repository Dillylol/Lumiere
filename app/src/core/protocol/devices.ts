/**
 * What a simulator's or robot's device report says about the robot's mechanisms: each mechanism's state,
 * judged from its devices' outputs, and each device's values in words.
 */
import { limitPower } from "../ir/hardware";
import type { Device, DeviceKind, HardwareDevice, Output, Subsystem } from "../ir/types";
import { olderLibrary } from "../sdk/deploy";

/** One device as a simulator or robot reports it, keyed by its configured name. */
export interface DeviceReport {
  /** `motor`, `servo` or `crservo`. */
  type: string;
  /** A motor's or continuous servo's power, as the OpMode set it. */
  power?: number;
  /** A servo's position as the OpMode set it (null before the first), or a motor's encoder count (simulator only). */
  position?: number | null;
}

/** A mechanism's state judged from its devices, and the reports for its devices. */
export interface MechanismReading {
  subsystem: Subsystem;
  /** The state whose outputs all match the devices, or null when none does. */
  stateId: string | null;
  devices: { device: Device; report?: DeviceReport }[];
}

const POWER_TOLERANCE = 0.02;
const POSITION_TOLERANCE = 0.02;
const TICK_TOLERANCE = 20;

/** Checks and bounds a report from the stream; anything malformed is left out. */
export function readDeviceReports(value: unknown): Record<string, DeviceReport> {
  const reports: Record<string, DeviceReport> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return reports;
  for (const [name, raw] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as { type?: unknown; power?: unknown; position?: unknown };
    if (typeof entry.type !== "string") continue;
    const report: DeviceReport = { type: entry.type.slice(0, 20) };
    if (typeof entry.power === "number" && Number.isFinite(entry.power)) report.power = entry.power;
    if (entry.position === null) report.position = null;
    else if (typeof entry.position === "number" && Number.isFinite(entry.position)) report.position = entry.position;
    reports[name.slice(0, 80)] = report;
  }
  return reports;
}

/**
 * A simulator before 0.4.0 (the robot library version its hello gives) reported a continuous servo's power
 * after its direction. This turns a reversed one's, by the hardware list, back to the power the OpMode set,
 * as every report gives it now.
 */
export function fromSimulator(reports: Record<string, DeviceReport>, library: string | undefined, hardware: HardwareDevice[] = []): Record<string, DeviceReport> {
  if (!library || !olderLibrary(library, "0.4.0")) return reports;
  const reversed = new Set(hardware.filter((device) => device.kind === "crservo" && device.reversed).map((device) => device.name));
  return Object.fromEntries(Object.entries(reports).map(([name, report]) =>
    [name, report.type === "crservo" && report.power !== undefined && reversed.has(name) ? { ...report, power: -report.power } : report]));
}

/** Whether a report shows an output, with its power cut to the device's limit as Lumière's code sends it. */
function matches(report: DeviceReport | undefined, output: Output, limit: number): boolean {
  if (!report) return false;
  switch (output.kind) {
    case "power":
      return report.power !== undefined && Math.abs(report.power - limitPower(output.value, limit)) <= POWER_TOLERANCE;
    case "position":
      return typeof report.position === "number" && Math.abs(report.position - output.value) <= POSITION_TOLERANCE;
    case "target":
      return typeof report.position === "number" && Math.abs(report.position - output.ticks) <= Math.max(TICK_TOLERANCE, Math.abs(output.ticks) * 0.02);
  }
}

/**
 * Which state each mechanism is in, judged from its devices' outputs. A state matches when all its
 * outputs do; when several match, the one setting the most devices wins. A motor driving to a target
 * matches once it is there, which only the simulator can tell, since a robot reports no encoder counts.
 * `hardware` is the robot's hardware list: Lumière's code cuts each power to its device's limit.
 */
export function readMechanisms(subsystems: Subsystem[], reports: Record<string, DeviceReport>, hardware: HardwareDevice[] = []): MechanismReading[] {
  const limits = new Map(hardware.map((device) => [device.name, device.powerLimit ?? 1]));
  return subsystems.map((subsystem) => {
    const devices = subsystem.devices.map((device) => ({ device, report: reports[device.name.trim()] }));
    const byId = new Map(devices.map((item) => [item.device.id, item]));
    let best: { id: string; size: number } | null = null;
    for (const state of subsystem.states) {
      const outputs = Object.entries(state.outputs).filter(([deviceId]) => byId.has(deviceId));
      if (!outputs.length) continue;
      if (!outputs.every(([deviceId, output]) => {
        const item = byId.get(deviceId)!;
        return matches(item.report, output, limits.get(item.device.name.trim()) ?? 1);
      })) continue;
      if (!best || outputs.length > best.size) best = { id: state.id, size: outputs.length };
    }
    return { subsystem, stateId: best?.id ?? null, devices };
  });
}

/** A device's reported values in words, such as "power 0.60 · 1240 ticks". */
export function describeReport(device: { kind: DeviceKind }, report: DeviceReport | undefined): string {
  if (!report) return "Not reported";
  const power = (value: number) => `power ${value.toFixed(2)}`;
  if (device.kind === "servo") return typeof report.position === "number" ? `position ${report.position.toFixed(2)}` : "position not set";
  if (device.kind === "crservo") return report.power === undefined ? "Not reported" : power(report.power);
  const parts = [report.power === undefined ? "" : power(report.power), typeof report.position === "number" ? `${Math.round(report.position)} ticks` : ""];
  return parts.filter(Boolean).join(" · ") || "Not reported";
}
