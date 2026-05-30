// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateRestartDialog } from "./UpdateRestartDialog";

const updaterMocks = vi.hoisted(() => ({
  phase: "ready",
  availableVersion: "0.1.42",
  restartPromptOpen: true,
  closeRestartPrompt: vi.fn(),
  restartNow: vi.fn(),
}));

vi.mock("@/hooks/access/tauri/use-updater", () => ({
  useUpdater: () => updaterMocks,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  updaterMocks.phase = "ready";
  updaterMocks.availableVersion = "0.1.42";
  updaterMocks.restartPromptOpen = true;
});

describe("UpdateRestartDialog", () => {
  it("renders the compact restart prompt when the update is ready", () => {
    render(<UpdateRestartDialog />);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getAllByText("Restart to finish updating").length).toBeGreaterThan(0);
    expect(screen.getByText("Proliferate 0.1.42 is installed and ready.")).toBeTruthy();
    expect(screen.getByText(/Anything running locally will stop/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("closes from Later and restarts from Restart now", () => {
    render(<UpdateRestartDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(updaterMocks.closeRestartPrompt).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Restart now" }));
    expect(updaterMocks.restartNow).toHaveBeenCalledTimes(1);
  });

  it("does not render when the ready prompt is closed", () => {
    updaterMocks.restartPromptOpen = false;

    render(<UpdateRestartDialog />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not render before the update is ready", () => {
    updaterMocks.phase = "available";

    render(<UpdateRestartDialog />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
