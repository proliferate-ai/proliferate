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
    expect(screen.getAllByText("Restart to update").length).toBeGreaterThan(0);
    expect(screen.getByText(/Proliferate 0\.1\.42 is ready\. Restart now to switch over\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("offers only Later and Restart now when nothing is running", () => {
    sessionMocks.runningCount = 0;

    render(<UpdateRestartDialog />);

    expect(screen.getByRole("button", { name: "Later" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restart now" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Restart when/ })).toBeNull();
  });

  it("pluralizes the deferred restart for several running sessions", () => {
    sessionMocks.runningCount = 3;

    render(<UpdateRestartDialog />);

    expect(screen.getByText(/3 sessions are running/)).toBeTruthy();
    expect(screen.getByText(/restarting stops them\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restart when it finishes" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Restart when they finish" }));
    expect(updaterMocks.scheduleRestartWhenIdle).toHaveBeenCalledTimes(1);
  });

  it("uses the singular deferred restart for one running session", () => {
    sessionMocks.runningCount = 1;

    render(<UpdateRestartDialog />);

    expect(screen.getByText(/1 session is running/)).toBeTruthy();
    expect(screen.getByText(/restarting stops it\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restart when they finish" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Restart when it finishes" }));
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
