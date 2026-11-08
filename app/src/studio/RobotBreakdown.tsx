import { useEffect, useState } from "react";
import type { Project } from "../core";
import { readRunTimings, subscribeToRunTimings, timingDelta, type RunTiming } from "./runTimings";

const KIND = { motor: "Motor", servo: "Servo", crservo: "Continuous servo" } as const;

function seconds(ms: number) {
  return (ms / 1000).toFixed(1) + " s";
}

/** The routine time when the OpMode reported one; otherwise START to STOP as the app observed it. */
function latest(timings: RunTiming[], opMode: string, source: RunTiming["source"]) {
  const matching = timings.filter(item => item.opMode === opMode && item.source === source);
  return matching.find(item => item.metric === "routine") ?? matching[0];
}

/** The robot as the project describes it, and how its runs compare between the desktop simulator and the robot. */
export function RobotBreakdown({ project }: { project: Project }) {
  const [timings, setTimings] = useState(() => readRunTimings(project.id));
  useEffect(() => {
    const refresh = () => setTimings(readRunTimings(project.id));
    refresh();
    return subscribeToRunTimings(project.id, refresh);
  }, [project.id]);

  const parts = project.subsystems.flatMap(mechanism => mechanism.devices.map(device => ({ device, mechanism: mechanism.name })));
  const opModes = [...new Set(timings.map(item => item.opMode))];
  const { widthInches, lengthInches, maxVelocity, maxAcceleration } = project.robot;

  return <section className="robot-breakdown" aria-labelledby="robot-breakdown-heading">
    <h2 id="robot-breakdown-heading">Robot breakdown</h2>
    <div className="breakdown-columns">
      <div>
        <h3>Parts</h3>
        {parts.length ? <table>
          <thead><tr><th scope="col">Device</th><th scope="col">Type</th><th scope="col">Mechanism</th><th scope="col">Direction</th></tr></thead>
          <tbody>{parts.map(({ device, mechanism }) => <tr key={device.id}>
            <td>{device.name}</td><td>{KIND[device.kind] ?? device.kind}</td><td>{mechanism}</td><td>{device.reversed ? "Reversed" : "Forward"}</td>
          </tr>)}</tbody>
        </table> : <p>Add a mechanism below to list its motors and servos here.</p>}
      </div>
      <div>
        <h3>Motion limits</h3>
        <dl className="stream-values">
          <div><dt>Footprint</dt><dd>{widthInches} × {lengthInches} in</dd></div>
          <div><dt>Top speed</dt><dd>{maxVelocity} in/s</dd></div>
          <div><dt>Acceleration</dt><dd>{maxAcceleration} in/s²</dd></div>
        </dl>
        <p className="breakdown-note">The preview plans motion within these limits. Edit them under Preview robot.</p>
      </div>
    </div>
    <h3>Simulated and real runs</h3>
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
