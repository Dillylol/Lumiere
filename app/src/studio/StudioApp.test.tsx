import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Brand, starter } from "./StudioApp";

describe("StudioApp identity and templates", () => {
  it("uses the flame mark without exposing a duplicate letter to assistive technology", () => {
    const { container } = render(<Brand />);
    expect(screen.getByText("Lumière")).toBeInTheDocument();
    expect(container.querySelector(".lucide-flame")).toBeInTheDocument();
    expect(container.querySelector(".studio-brand b")).toHaveAttribute("aria-hidden", "true");
  });

  it("creates a square autonomous with four paths and a closing wait", () => {
    const project = starter("Test Robot", "square");
    const program = project.programs[0];
    expect(program?.kind).toBe("autonomous");
    if (program?.kind !== "autonomous") throw new Error("Expected autonomous program");
    expect(program.paths).toHaveLength(4);
    expect(program.routine).toHaveLength(5);
    expect(program.routine[program.routine.length - 1]?.kind).toBe("wait");
  });
});
