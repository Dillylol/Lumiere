import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataPanel } from "./DataPanel";
import type { RunSample } from "./useRunSession";

/** Ten samples a second, driving +x at 20 in/s, with a Session.data value and a device. */
const history: RunSample[] = Array.from({ length: 21 }, (_, i) => ({
  t: i * 100, x: 10 + i * 2, y: 30, heading: 0, loopMs: 8,
  data: { shooterRpm: 3000 + i * 10, "lumiere.routineElapsedMs": 5000 },
  devices: { intake: { type: "motor", power: 0.6, position: i * 50 } },
}));

describe("DataPanel", () => {
  afterEach(cleanup);

  it("graphs the run beside the plan, with every value printed", () => {
    render(<DataPanel history={history} live={false} planLabel="the estimate"
      planAt={(t) => ({ x: 10 + t / 50, y: 30, heading: 0, speed: 18 })} offPlanAt={(x) => Math.abs(x - 40) / 10}/>);
    expect(screen.getByLabelText("Graph key")).toHaveTextContent("RobotPlan: the estimate");
    const speed = screen.getByRole("img", { name: /^Speed:/ });
    expect(speed).toHaveAccessibleName("Speed: 20 in/s, plan 18 in/s");
    expect(screen.getByRole("img", { name: /^X:/ })).toHaveAccessibleName("X: 50.0 in, plan 50.0 in");
    expect(screen.getByRole("img", { name: /^Off plan:/ })).toHaveAccessibleName("Off plan: 1.0 in");
    expect(screen.getByText("Whole run · 2.0 s")).toBeInTheDocument();
    // Run timing values are not graphed; the team's own Session.data and devices are offered.
    const chips = screen.getByRole("group", { name: "Values to graph" });
    expect(within(chips).queryByRole("button", { name: "lumiere.routineElapsedMs" })).toBeNull();
    fireEvent.click(within(chips).getByRole("button", { name: "shooterRpm" }));
    expect(screen.getByRole("img", { name: /^shooterRpm:/ })).toHaveAccessibleName("shooterRpm: 3200.00");
    fireEvent.click(within(chips).getByRole("button", { name: "intake ticks" }));
    expect(screen.getByRole("img", { name: /^intake ticks:/ })).toHaveAccessibleName("intake ticks: 1000");
  });

  it("reads every chart at one moment with the arrow keys", () => {
    render(<DataPanel history={history} live={false}/>);
    const charts = screen.getByRole("group", { name: /Run graphs/ });
    charts.focus();
    fireEvent.keyDown(charts, { key: "Home" });
    expect(screen.getByText("At 0.0 s")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^X:/ })).toHaveAccessibleName("X: 10.0 in");
    fireEvent.keyDown(charts, { key: "ArrowRight", shiftKey: true });
    expect(screen.getByText("At 1.0 s")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^X:/ })).toHaveAccessibleName("X: 30.0 in");
    fireEvent.keyDown(charts, { key: "Escape" });
    expect(screen.getByText("Whole run · 2.0 s")).toBeInTheDocument();
  });

  it("follows the last 30 seconds while the run goes, and says when there is nothing yet", () => {
    const long = Array.from({ length: 401 }, (_, i) => ({ ...history[0], t: i * 100, x: i }));
    const { rerender } = render(<DataPanel history={long} live/>);
    expect(screen.getByText("Last 30 s · now 40.0 s")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("button", { name: "Follow the run" })).toBeInTheDocument();
    rerender(<DataPanel history={[]} live/>);
    expect(screen.getByText(/Graphs of the run appear here once an OpMode starts/)).toBeInTheDocument();
  });
});
