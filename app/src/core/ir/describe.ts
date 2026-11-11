/**
 * Routine actions in words, as Build and Pathing list them, such as "Intake: In for 2.0 s, then Off" or
 * "intake: power 0.5". Unfinished actions say what is still to choose.
 */
import { deviceKindLabel } from "./hardware";
import type { DeviceStep, Output, Project, Step } from "./types";

type StateStep = Extract<Step, { kind: "state" }>;

const shown = (value: number) => String(Math.round(value * 1000) / 1000);

/** A duration in seconds with one decimal, such as "2.0 s". */
export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** An output in words, such as "power 0.5", "position 0.3" or "1200 ticks at power 0.8". */
export function describeOutput(output: Output): string {
  switch (output.kind) {
    case "power": return `power ${shown(output.value)}`;
    case "position": return `position ${shown(output.value)}`;
    case "target": return `${Math.round(output.ticks)} ticks at power ${shown(output.power)}`;
  }
}

/** A device action in words, such as "intake: power 0.5 for 2.0 s, then off", or what is still to choose. */
export function describeDeviceStep(step: DeviceStep): string {
  const name = step.device.trim();
  if (!name) return `Choose a ${deviceKindLabel(step.deviceKind)}`;
  const timed = step.duration
    ? ` for ${seconds(step.duration.ms)}, then ${step.deviceKind === "servo" ? `position ${shown(step.duration.thenPosition ?? 0)}` : "off"}`
    : "";
  return `${name}: ${describeOutput(step.output)}${timed}`;
}

/** A mechanism action in words, such as "Intake: In for 2.0 s, then Off", or what is still to choose. */
export function describeStateStep(project: Project, step: StateStep): string {
  const subsystem = project.subsystems.find((item) => item.id === step.subsystemId);
  if (!subsystem) return step.subsystemId ? "Mechanism missing" : "Choose a mechanism";
  const stateName = (id: string, unset: string) => (id ? subsystem.states.find((item) => item.id === id)?.name ?? "State missing" : unset);
  const state = stateName(step.stateId, "choose a state");
  const timed = step.duration ? ` for ${seconds(step.duration.ms)}, then ${stateName(step.duration.thenStateId, "choose a state")}` : "";
  return `${subsystem.name}: ${state}${timed}`;
}
