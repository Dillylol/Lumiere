import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUpdater } from "./useUpdater";

const mocks = vi.hoisted(() => ({ check: vi.fn(), relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));

function Harness() {
  const updater = useUpdater();
  return <>
    <output>{updater.state.phase}:{updater.state.version}:{updater.state.progress}</output>
    <button onClick={() => void updater.install()}>Install</button>
  </>;
}

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.clearAllMocks();
});

describe("desktop updater", () => {
  it("checks, downloads a signed update, and restarts", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    const close = vi.fn();
    const downloadAndInstall = vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 40 } });
      onEvent({ event: "Progress", data: { chunkLength: 60 } });
      onEvent({ event: "Finished", data: {} });
    });
    mocks.check.mockResolvedValue({ version: "0.1.3", body: "A safer release.", close, downloadAndInstall });

    const view = render(<Harness />);
    await screen.findByText("available:0.1.3:");
    await act(async () => screen.getByRole("button", { name: "Install" }).click());

    await waitFor(() => expect(mocks.relaunch).toHaveBeenCalledOnce());
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(screen.getByText("restarting:0.1.3:")).toBeInTheDocument();
    view.unmount();
    expect(close).toHaveBeenCalledOnce();
  });
});
