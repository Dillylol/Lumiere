import type { ProgramAction } from "../models/project";

export interface Pose { x: number; y: number; heading: number }
export interface PreviewStep { from: Pose; to: Pose; duration: number; label: string }
const clamp = (value: number) => Math.max(0, Math.min(144, value));
export const normalizePose = (pose: Pose): Pose => ({
  x: clamp(pose.x), y: clamp(pose.y), heading: ((pose.heading % 360) + 360) % 360,
});

/** Temporary v1 preview. Distances are estimates, not execution of FTC Java. */
export function previewSteps(actions: ProgramAction[], start: Pose): PreviewStep[] {
  const steps: PreviewStep[] = [];
  let current = normalizePose(start);
  for (const action of actions) {
    if (!action.enabled) continue;
    if (action.kind === "stop") break;
    let to = { ...current };
    let duration = Math.max(0, Number(action.args.duration) || 0);
    if (action.kind === "turn") {
      to.heading += (action.args.direction === "left" ? 1 : -1) * Number(action.args.power) * 90 * duration / 1000;
    } else if (action.kind === "drive") {
      const direction = String(action.args.direction);
      const forward = direction === "forward" ? 1 : ["back", "backward"].includes(direction) ? -1 : 0;
      const left = direction === "left" ? 1 : direction === "right" ? -1 : 0;
      const distance = Number(action.args.power) * 36 * duration / 1000;
      const angle = current.heading * Math.PI / 180;
      to.x = clamp(current.x + (forward * Math.cos(angle) - left * Math.sin(angle)) * distance);
      to.y = clamp(current.y + (forward * Math.sin(angle) + left * Math.cos(angle)) * distance);
    } else if (action.kind === "path") {
      const [x, y, heading] = String(action.args.values ?? "").split(",").map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        to = { x: clamp(x), y: clamp(y), heading: Number.isFinite(heading) ? heading : current.heading };
        duration = 800;
      }
    }
    steps.push({ from: current, to, duration, label: action.label });
    current = normalizePose(to);
  }
  return steps;
}
