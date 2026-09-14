import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProgramIR } from "../models/project";
import { PathEditor } from "./PathEditor";

describe("PathEditor", () => {
  it("adds an editable waypoint to the canonical program", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const ir: ProgramIR = { version: 1, actions: [] };
    render(<PathEditor ir={ir} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Add center point" }));

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0].actions[0]).toMatchObject({
      kind: "path",
      args: { mode: "linear", values: "72, 72, 0" },
    });
  });
});
