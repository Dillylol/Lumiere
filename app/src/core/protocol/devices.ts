/**
 * What a simulator's device report says about the robot's mechanisms: each mechanism's state, judged
 * from its devices' outputs, and each device's values in words.
 */
import type { Device, Output, Subsystem } from "../ir/types";

/** One device as the simulator reports it, keyed by its configured name. */
export interface DeviceReport {
  /** `motor`, `servo` or `crservo`. */
  type: string;
  /** Motor power as the OpMode set it; a continuous servo's power after its direction. */
  power?: number;
  /** A servo's position as the OpMode set it (null before the first), or a motor's encoder count. */
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

function matches(device: Device, output: Output, report: DeviceReport | undefined): boolean {
  if (!report) return false;
  switch (output.kind) {
    case "power": {
      if (report.power === undefined) return false;
      // A continuous servo reports its power after its direction, so a reversed one reads negated.
      const commanded = device.kind === "crservo" && device.reversed ? -report.power : report.power;
      return Math.abs(commanded - output.value) <= POWER_TOLERANCE;
    }
    case "position":
      return typeof report.position === "number" && Math.abs(report.position - output.value) <= POSITION_TOLERANCE;
    case "target":
      return typeof report.position === "number" && Math.abs(report.position - output.ticks) <= Math.max(TICK_TOLERANCE, Math.abs(output.ticks) * 0.02);
  }
}

/**
 * Which state each mechanism is in, judged from its devices' outputs. A state matches when all its
 * outputs do; when several match, the one setting the most devices wins. A motor driving to a target
 * matches once it is there.
 */
export function readMechanisms(subsystems: Subsystem[], reports: Record<string, DeviceReport>): MechanismReading[] {
  return subsystems.map((subsystem) => {
    const devices = subsystem.devices.map((device) => ({ device, report: reports[device.name.trim()] }));
    const byId = new Map(devices.map((item) => [item.device.id, item]));
    let best: { id: string; size: number } | null = null;
    for (const state of subsystem.states) {
      const outputs = Object.entries(state.outputs).filter(([deviceId]) => byId.has(deviceId));
      if (!outputs.length) continue;
      if (!outputs.every(([deviceId, output]) => matches(byId.get(deviceId)!.device, output, byId.get(deviceId)!.report))) continue;
      if (!best || outputs.length > best.size) best = { id: state.id, size: outputs.length };
    }
    return { subsystem, stateId: best?.id ?? null, devices };
  });
}

/** A device's reported values in words, such as "power 0.60 · 1240 ticks". */
export function describeReport(device: Pick<Device, "kind" | "reversed">, report: DeviceReport | undefined): string {
  if (!report) return "Not reported";
  const power = (value: number) => `power ${value.toFixed(2)}`;
  if (device.kind === "servo") return typeof report.position === "number" ? `position ${report.position.toFixed(2)}` : "position not set";
  if (device.kind === "crservo") return report.power === undefined ? "Not reported" : power(device.reversed ? -report.power : report.power);
  const parts = [report.power === undefined ? "" : power(report.power), typeof report.position === "number" ? `${Math.round(report.position)} ticks` : ""];
  return parts.filter(Boolean).join(" · ") || "Not reported";
}
