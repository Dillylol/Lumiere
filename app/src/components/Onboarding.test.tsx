import { BRAND } from "../brand";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding";

describe("Onboarding", () => {
  it("offers both experiences and returns the chosen mode", async () => {
    const choose = vi.fn();
    render(<Onboarding onChoose={choose} />);
    expect(screen.getByRole("heading", { name: `Welcome to ${BRAND.name}` })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Beginner/ }));
    expect(choose).toHaveBeenCalledWith("beginner");
  });
});

