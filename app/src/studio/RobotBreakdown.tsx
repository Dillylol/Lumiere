import { useEffect, useState } from "react";
import type { Project } from "../core";
import { readRunTimings, subscribeToRunTimings, timingDelta, type RunTiming } from "./runTimings";

function seconds(ms: number) {
  return (ms / 1000).toFixed(1) + " s";
}

/** The routine time when the OpMode reported one; otherwise START to STOP as the app observed it. */
function latest(timings: RunTiming[], opMode: string, source: RunTiming["source"]) {
  const matching = timings.filter(item => item.opMode === opMode && item.source === source);
  return matching.find(item => item.metric === "routine") ?? matching[0];
}

/** How each OpMode's latest runs compare between the desktop simulator and the robot. */
export function RobotBreakdown({ project }: { project: Project }) {
  const [timings, setTimings] = useState(() => readRunTimings(project.id));
  useEffect(() => {
    const refresh = () => setTimings(readRunTimings(project.id));
    refresh();
    return subscribeToRunTimings(project.id, refresh);
  }, [project.id]);
  const opModes = [...new Set(timings.map(item => item.opMode))];

  return <section className="robot-breakdown" aria-labelledby="robot-runs-heading">
    <h2 id="robot-runs-heading">Simulated and real runs</h2>
    {opModes.length ? <table>
      <thead><tr><th scope="col">OpMode</th><th scope="col">Desktop sim</th><th scope="col">Robot</th><th scope="col">Difference</th></tr></thead>
      <tbody>{opModes.map(name => {
        const simulator = latest(timings, name, "simulator");
        const robot = latest(timings, name, "robot");
        const delta = timingDelta(simulator, robot);
        const difference = delta !== undefined ? (delta >= 0 ? "+" : "−") + seconds(Math.abs(delta))
          : simulator && robot ? "Not comparable" : "—";
        return <tr key={name}>
          <td>{name}</td>
          <td>{simulator ? seconds(simulator.elapsedMs) : "—"}</td>
          <td>{robot ? seconds(robot.elapsedMs) : "—"}</td>
          <td title={difference === "Not comparable" ? "These runs used different timing markers or routine revisions." : undefined}>{difference}</td>
        </tr>;
      })}</tbody>
    </table> : <p>Runs from the desktop simulator and the robot stream appear here once they finish.</p>}
  </section>;
}
