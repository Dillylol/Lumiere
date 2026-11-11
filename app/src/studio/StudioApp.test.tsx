import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Brand, mergeLoadedProjects, starter } from "./StudioApp";

describe("StudioApp identity and templates", () => {
  it("uses the flame mark without exposing a duplicate letter to assistive technology", () => {
    const { container } = render(<Brand />);
    expect(screen.getByText("Lumière")).toBeInTheDocument();
    expect(container.querySelector(".lucide-flame")).toBeInTheDocument();
    const mark = screen.getByRole("button", { name: "Lumière flame" });
    expect(mark).toHaveAttribute("aria-haspopup", "dialog");
    expect(mark.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps a project made before the saved ones finished loading", () => {
    const made = starter("Made early", "square");
    const saved = starter("Saved before", "blank");
    // The project made early may or may not already be in what loaded; either way it stays, once.
    expect(mergeLoadedProjects([made], [saved]).map((project) => project.name)).toEqual(["Made early", "Saved before"]);
    expect(mergeLoadedProjects([made], [made, saved]).map((project) => project.name)).toEqual(["Made early", "Saved before"]);
    expect(mergeLoadedProjects([], [saved])).toEqual([saved]);
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
