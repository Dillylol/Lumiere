import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NumberField } from "./ProgramEditor";

function Harness({ onChange, ...limits }: { onChange: (n: number) => void; min?: number; max?: number; integer?: boolean }) {
  const [value, setValue] = useState(18);
  return <NumberField label="Width (in)" value={value} {...limits} onChange={(n) => { setValue(n); onChange(n); }} />;
}

describe("NumberField", () => {
  afterEach(cleanup);

  it("passes values inside the range on while typing", async () => {
    const onChange = vi.fn();
    render(<Harness min={4} max={36} onChange={onChange} />);
    const input = screen.getByLabelText("Width (in)");
    await userEvent.clear(input);
    await userEvent.type(input, "24");
    expect(onChange).toHaveBeenLastCalledWith(24);
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("holds an out-of-range value back and clamps it when the field loses focus", async () => {
    const onChange = vi.fn();
    render(<Harness min={4} max={36} onChange={onChange} />);
    const input = screen.getByLabelText("Width (in)");
    await userEvent.clear(input);
    await userEvent.type(input, "50");
    expect(onChange).not.toHaveBeenCalledWith(50);
    expect(input).toHaveAttribute("aria-invalid", "true");
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith(36);
    expect(input).toHaveValue(36);
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("clamps up to the minimum on Enter and rounds whole-number fields", async () => {
    const onChange = vi.fn();
    render(<Harness min={4} max={36} integer onChange={onChange} />);
    const input = screen.getByLabelText("Width (in)");
    await userEvent.clear(input);
    await userEvent.type(input, "2{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(4);
    await userEvent.clear(input);
    await userEvent.type(input, "12.6");
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith(13);
  });

  it("restores the current value when the field is left empty", async () => {
    const onChange = vi.fn();
    render(<Harness min={4} max={36} onChange={onChange} />);
    const input = screen.getByLabelText("Width (in)");
    await userEvent.clear(input);
    await userEvent.tab();
    expect(input).toHaveValue(18);
  });
});
