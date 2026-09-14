import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Play, RotateCcw, Square } from "lucide-react";
import { parseJules } from "../language/julesLanguage";
import { normalizePose, previewSteps, type Pose } from "./previewMotion";

interface SimulatorTabProps { code: string; visible: boolean; stopRevision?: number }
const INITIAL_POSE: Pose = { x: 72, y: 72, heading: 0 };
const GRID = Array.from({ length: 13 }, (_, index) => index * 12);

export function SimulatorTab({ code, visible, stopRevision = 0 }: SimulatorTabProps) {
  const [pose, setPose] = useState(INITIAL_POSE);
  const [startPose, setStartPose] = useState(INITIAL_POSE);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const frame = useRef(0);
  const parsed = useMemo(() => parseJules(code), [code]);
  const steps = useMemo(() => previewSteps(parsed.ir.actions, startPose), [parsed, startPose]);
  const invalid = parsed.diagnostics.some((problem) => problem.severity === "error");

  useEffect(() => {
    cancelAnimationFrame(frame.current);
    setIsRunning(false);
    setProgress("");
    return () => cancelAnimationFrame(frame.current);
  }, [visible, code, stopRevision]);

  const stop = () => {
    cancelAnimationFrame(frame.current);
    setIsRunning(false);
    setProgress("Preview stopped");
  };
  const reset = () => {
    stop();
    setPose(normalizePose(startPose));
    setProgress("");
  };
  const run = () => {
    if (isRunning || invalid || !visible) return;
    setPose(normalizePose(startPose));
    setIsRunning(true);
    let index = 0;
    let began = performance.now();
    const tick = (now: number) => {
      while (index < steps.length && now - began >= steps[index].duration) {
        setPose(normalizePose(steps[index].to));
        began += steps[index].duration;
        index += 1;
      }
      if (index === steps.length) {
        setIsRunning(false);
        setProgress("Preview complete");
        return;
      }
      const step = steps[index];
      const ratio = Math.min(1, (now - began) / step.duration);
      setProgress(step.label);
      setPose(normalizePose({
        x: step.from.x + (step.to.x - step.from.x) * ratio,
        y: step.from.y + (step.to.y - step.from.y) * ratio,
        heading: step.from.heading + (step.to.heading - step.from.heading) * ratio,
      }));
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  const changeStart = (key: keyof Pose, value: number) => {
    const next = normalizePose({ ...startPose, [key]: Number.isFinite(value) ? value : 0 });
    setStartPose(next);
    setPose(next);
    setProgress("");
  };
  const points = [startPose, ...steps.map((step) => step.to)].map((point) => `${point.x},${point.y}`).join(" ");

  return <div className="simulator-layout">
    <aside className="sim-sidebar">
      <div className="sim-sidebar__title"><MapPin aria-hidden="true" /> Position</div>
      <div className="sim-pose"><span>X <strong>{Math.round(pose.x)}&quot;</strong></span><span>Y <strong>{Math.round(pose.y)}&quot;</strong></span><span>Heading <strong>{Math.round(pose.heading)}°</strong></span></div>
      <fieldset className="sim-start-fields" disabled={isRunning}><legend>Start pose</legend>
        <label>X (in)<input type="number" min="0" max="144" value={startPose.x} onChange={(event) => changeStart("x", event.target.valueAsNumber)} /></label>
        <label>Y (in)<input type="number" min="0" max="144" value={startPose.y} onChange={(event) => changeStart("y", event.target.valueAsNumber)} /></label>
        <label>Heading<input type="number" value={startPose.heading} onChange={(event) => changeStart("heading", event.target.valueAsNumber)} /></label>
      </fieldset>
      <p className="sim-coordinate-note">0–144 inches. Heading 0° points right; positive angles turn counterclockwise. Motion is an estimate.</p>
      <div className="sim-sidebar__actions">
        <div className="sim-progress" role="status">{invalid ? "Fix program errors before previewing" : progress || "Ready to preview"}</div>
        <button className="button button--primary" type="button" onClick={isRunning ? stop : run} disabled={invalid}>{isRunning ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}{isRunning ? "Stop preview" : "Run preview"}</button>
        <button className="button button--secondary" type="button" onClick={reset}><RotateCcw aria-hidden="true" /> Reset</button>
      </div>
    </aside>
    <div className="sim-canvas">
      <svg viewBox="-10 -10 164 164" role="img" aria-label="FTC field preview, origin at bottom left">
        <g transform="translate(0 144) scale(1 -1)">
          <rect width="144" height="144" className="sim-field" />
          {GRID.map((value) => <path key={value} d={`M ${value} 0 V 144 M 0 ${value} H 144`} className="sim-grid" />)}
          <polyline points={points} className="sim-route" />
          <g transform={`translate(${pose.x} ${pose.y}) rotate(${pose.heading})`}>
            <rect x="-9" y="-9" width="18" height="18" rx="2" className="sim-robot" />
            <path d="M -5 0 H 6 M 2 -4 L 6 0 L 2 4" className="sim-heading" />
          </g>
        </g>
        <text x="0" y="152" className="sim-axis">0,0</text><text x="128" y="152" className="sim-axis">144,0</text>
        <text x="0" y="-3" className="sim-axis">0,144</text>
      </svg>
    </div>
  </div>;
}
