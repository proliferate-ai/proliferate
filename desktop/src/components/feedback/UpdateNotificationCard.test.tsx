// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateNotificationCard } from "./UpdateNotificationCard";

const updaterMocks = vi.hoisted(() => ({
  phase: "available",
  availableVersion: "0.1.24",
  downloadProgress: null as number | null,
  downloadUpdate: vi.fn(),
  openRestartPrompt: vi.fn(),
}));

const shellMocks = vi.hoisted(() => ({
  openExternal: vi.fn(),
}));

vi.mock("@/hooks/access/tauri/use-updater", () => ({
  useUpdater: () => updaterMocks,
}));

vi.mock("@/hooks/access/tauri/use-shell-actions", () => ({
  useTauriShellActions: () => shellMocks,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  updaterMocks.phase = "available";
  updaterMocks.availableVersion = "0.1.24";
  updaterMocks.downloadProgress = null;
});

describe("UpdateNotificationCard", () => {
  it("renders update actions and links to the changelog", () => {
    render(<UpdateNotificationCard />);

    expect(screen.getByLabelText("Desktop update is available")).toBeTruthy();
    expect(screen.getByText("New update available")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "See changes" }));
    expect(shellMocks.openExternal).toHaveBeenCalledWith(
      "https://proliferate.com/changelog",
    );

    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(updaterMocks.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("can be dismissed for the current update version", () => {
    render(<UpdateNotificationCard />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss update notification" }));

    expect(screen.queryByLabelText("Desktop update is available")).toBeNull();
  });
});
