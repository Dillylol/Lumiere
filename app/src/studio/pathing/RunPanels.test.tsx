import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import sample from "../../../../fixtures/projects/sample-robot.json";
import { parseProject } from "../../core";
import { RunPanel, TelemetryPanel, type RunEnvironment } from "./RunPanels";
import type { RunSession } from "./useRunSession";

const project = parseProject(structuredClone(sample));
const program = project.programs[0];

/** A simulator session with nothing reported yet. */
function session(overrides: Partial<RunSession> = {}): RunSession {
  return {
    source: "simulator", status: "Disconnected", linked: false, connected: false, finding: false,
    modes: [], mode: "", setMode: vi.fn(), phase: "idle", active: null, trail: [], telemetry: [], devices: {}, data: {},
    elapsed: 0, limit: 30, setLimit: vi.fn(), keyboard: false, setKeyboard: vi.fn(), press: vi.fn(),
    open: vi.fn(), find: vi.fn(), disconnect: vi.fn(), init: vi.fn(), start: vi.fn(), run: vi.fn(), stop: vi.fn(),
    ...overrides,
  };
}

function environment(overrides: Partial<RunEnvironment> = {}): RunEnvironment {
  return {
    desktop: true, busy: "", canLaunch: true, launch: vi.fn(), cancel: vi.fn(), onLog: vi.fn(),
    host: "127.0.0.1", onHost: vi.fn(), onScan: vi.fn(), onRobotSetup: vi.fn(), ...overrides,
  };
}

describe("Simulate panels", () => {
  it("shows a launch as it goes, and why it failed", () => {
    const startup = { stage: "building" as const, line: "> Task :TeamCode:compileDebugJavaWithJavac", startedAt: Date.now() - 12_400 };
    const { rerender } = render(<RunPanel mode="simulate" session={session()} project={project} program={program}
      env={environment({ busy: "Starting simulator", startup })} onHide={vi.fn()}/>);
    const progress = screen.getByRole("status", { name: "Simulator startup" });
    expect(within(progress).getByText("Saving and deploying your code").closest("li")).toHaveClass("done");
    expect(within(progress).getByText(/Building it with Gradle/).closest("li")).toHaveClass("current");
    expect(progress).toHaveTextContent("· 12 s");
    expect(progress).toHaveTextContent("> Task :TeamCode:compileDebugJavaWithJavac");
    expect(screen.getByRole("button", { name: "Cancel startup" })).toBeEnabled();

    const showOutput = vi.fn();
    const dismiss = vi.fn();
    rerender(<RunPanel mode="simulate" session={session()} project={project} program={program} env={environment({
      startupError: { summary: "The simulator did not start (Gradle exit code 1).", detail: "classes.jar is being used by another process", hint: "Close the other program, then launch again." },
      showOutput, dismissStartupError: dismiss,
    })} onHide={vi.fn()}/>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The simulator did not start (Gradle exit code 1).");
    expect(alert).toHaveTextContent("classes.jar is being used by another process");
    expect(alert).toHaveTextContent("Close the other program, then launch again.");
    fireEvent.click(within(alert).getByRole("button", { name: "Show build output" }));
    fireEvent.click(within(alert).getByRole("button", { name: "Dismiss" }));
    expect(showOutput).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status", { name: "Simulator startup" })).toBeNull();
  });

  it("says what to press once connected", () => {
    render(<RunPanel mode="simulate" session={session({ linked: true, connected: true, status: "Connected", mode: "Blue Basket" })}
      project={project} program={program} env={environment()} onHide={vi.fn()}/>);
    expect(screen.getByText("Ready: press RUN, or INIT, then START, under the field.")).toBeInTheDocument();
  });

  it("shows each mechanism's state from the simulator's devices, beside the plan's", () => {
    render(<TelemetryPanel project={project} program={program} onHide={vi.fn()} planned={{ mech_claw: "state_claw_closed", mech_lift: "state_lift_down" }}
      session={session({ linked: true, connected: true, devices: {
        claw: { type: "servo", position: 0.8 },
        lift_motor: { type: "motor", power: 0.8, position: 3 },
        intake_left: { type: "crservo", power: 0 },
        intake_right: { type: "crservo", power: 0 },
        turret: { type: "motor", power: 0.3, position: 12 },
      } })}/>);
    const states = screen.getByLabelText("Mechanism states");
    const claw = within(states).getByText("Claw").parentElement!;
    expect(claw).toHaveTextContent("Open");
    expect(claw).toHaveTextContent("Plan: Closed");
    expect(claw).toHaveTextContent("claw: position 0.80");
    expect(within(states).getByText("Lift").parentElement).toHaveTextContent("Down");
    expect(within(states).getByText("Intake").parentElement).toHaveTextContent("Stop");
    expect(screen.getByText("Other devices (1)")).toBeInTheDocument();
    expect(screen.getByText("turret: power 0.30 · 12 ticks")).toBeInTheDocument();
  });
});
