// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateRestartDialog } from "./UpdateRestartDialog";

const updaterMocks = vi.hoisted(() => ({
  phase: "ready",
  availableVersion: "0.1.42",
  restartPromptOpen: true,
  closeRestartPrompt: vi.fn(),
  scheduleRestartWhenIdle: vi.fn(),
  restartNow: vi.fn(),
}));

const sessionMocks = vi.hoisted(() => ({ runningCount: 0 }));

vi.mock("@/hooks/access/tauri/use-updater", () => ({
  useUpdater: () => updaterMocks,
}));

vi.mock("@/hooks/app/lifecycle/use-running-agent-count", () => ({
  useRunningAgentCount: () => sessionMocks.runningCount,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  updaterMocks.phase = "ready";
  updaterMocks.availableVersion = "0.1.42";
  updaterMocks.restartPromptOpen = true;
  sessionMocks.runningCount = 0;
});

describe("UpdateRestartDialog", () => {
  it("renders the restart prompt when the update is ready", () => {
    render(<UpdateRestartDialog />);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getAllByText("Restart to finish updating").length).toBeGreaterThan(0);
    expect(screen.getByText(/Proliferate 0\.1\.42 is installed/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("offers only Later and Restart now when nothing is running", () => {
    sessionMocks.runningCount = 0;

    render(<UpdateRestartDialog />);

    expect(screen.getByRole("button", { name: "Later" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restart now" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restart when they finish" })).toBeNull();
  });

  it("warns about running sessions and offers to defer the restart", () => {
    sessionMocks.runningCount = 3;

    render(<UpdateRestartDialog />);

    expect(screen.getByText(/3 sessions are running/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Restart when they finish" }));
    expect(updaterMocks.scheduleRestartWhenIdle).toHaveBeenCalledTimes(1);
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
