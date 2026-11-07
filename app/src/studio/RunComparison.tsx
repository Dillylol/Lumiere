import { useEffect, useState } from "react";
import { readRunTimings, subscribeToRunTimings, timingDelta, type RunTiming } from "./runTimings";
import "./run-comparison.css";

function seconds(ms: number) {
  return (ms / 1000).toFixed(1) + " s";
}

function RunValue({ label, timing }: { label: string; timing?: RunTiming }) {
  // A <dl> group may hold only <dt> and <dd>, so the caption lives inside the value.
  return <div>
    <dt>{label}</dt>
    <dd>
      {timing ? seconds(timing.elapsedMs) : "—"}
      <small>{timing ? timing.metric === "routine" ? "Routine time" : "START to STOP" : "Awaiting run"}</small>
    </dd>
  </div>;
}

export function RunComparison({ projectId, opModeName }: { projectId: string; opModeName?: string }) {
  const [timings, setTimings] = useState(() => readRunTimings(projectId));
  const [choice, setChoice] = useState<string>();
  useEffect(() => {
    const refresh = () => setTimings(readRunTimings(projectId));
    refresh();
    return subscribeToRunTimings(projectId, refresh);
  }, [projectId]);

  const names = [...new Set(timings.map(item => item.opMode))];
  const selected = choice && names.includes(choice) ? choice : opModeName || names[0];
  const matching = timings.filter(item => item.opMode === selected);
  // A manual STOP during another attempt must not erase a measured routine finish.
  const latest = (source: RunTiming["source"]) => matching.find(item => item.source === source && item.metric === "routine")
    ?? matching.find(item => item.source === source);
  const simulator = latest("simulator");
  const robot = latest("robot");
  const delta = timingDelta(simulator, robot);
  const rounded = delta === undefined ? undefined : Math.round(delta / 100) * 100;
  let detail = "Run this OpMode in the desktop simulator and on the robot to compare.";
  if (simulator && robot) {
    if (simulator.metric !== robot.metric) detail = "These runs used different timing markers.";
    else if (simulator.revision !== robot.revision) detail = "These runs used different or unverified routine revisions.";
    else if (rounded !== undefined) {
      detail = rounded === 0 ? "Within 0.1 s" : "Robot ran " + seconds(Math.abs(rounded)) + (rounded > 0 ? " longer" : " shorter");
      if (simulator.metric === "lifecycle") detail += " from START to STOP.";
      else if (!simulator.revision) detail += ". Matched by OpMode name.";
      else detail += ".";
    }
  }
  const options = opModeName && !names.includes(opModeName) ? [opModeName, ...names] : names;
  return <section className="run-comparison" aria-label="Run comparison">
    <h3>Run comparison</h3>
    {options.length > 1 ? <label>Compared OpMode<select value={selected} onChange={event => setChoice(event.target.value)}>
      {options.map(name => <option key={name}>{name}</option>)}
    </select></label> : selected && <p className="run-comparison-mode">{selected}</p>}
    <dl>
      <RunValue label="Desktop sim" timing={simulator} />
      <RunValue label="Robot stream" timing={robot} />
    </dl>
    <p>{detail}</p>
    {(simulator?.metric === "lifecycle" || robot?.metric === "lifecycle") &&
      <p className="run-comparison-note">START to STOP is observed by the app and includes any time spent waiting to stop.</p>}
  </section>;
}
