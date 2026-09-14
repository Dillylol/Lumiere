import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HomeScreen } from "./HomeScreen";

describe("HomeScreen", () => {
  it("keeps project-name focus while typing in the create dialog", async () => {
    const user = userEvent.setup();
    render(<HomeScreen mode="beginner" projects={[]} storageKind="web" onModeChange={vi.fn()} onCreate={vi.fn()} onOpen={vi.fn()} onImport={vi.fn()} onDelete={vi.fn()} onDuplicate={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /New project/i }));
    const name = screen.getByLabelText("Project name");
    expect(name).toHaveFocus();
    await user.clear(name);
    await user.type(name, "Centerstage Robot");

    expect(name).toHaveValue("Centerstage Robot");
    expect(name).toHaveFocus();
  });
});
