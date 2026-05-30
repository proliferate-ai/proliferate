// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateNotificationCard } from "./UpdateNotificationCard";

const updaterMocks = vi.hoisted(() => ({
  phase: "available",
  availableVersion: "0.1.24",
  downloadProgress: null as number | null,
  restartPromptOpen: false,
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
  updaterMocks.restartPromptOpen = false;
});

describe("UpdateNotificationCard", () => {
  it("renders update actions and links to the changelog", () => {
    render(<UpdateNotificationCard />);

    expect(screen.getByLabelText("Desktop update is available")).toBeTruthy();
    expect(screen.getByText("Update available")).toBeTruthy();
    expect(screen.getByText("Proliferate 0.1.24 is ready to download.")).toBeTruthy();

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

  it("renders downloading state without progress or duplicate update actions", () => {
    updaterMocks.phase = "downloading";
    updaterMocks.downloadProgress = 68;

    render(<UpdateNotificationCard />);

    expect(screen.getByLabelText("Desktop update is downloading")).toBeTruthy();
    expect(screen.getByText("Downloading update")).toBeTruthy();
    expect(screen.getByText("Preparing the update in the background.")).toBeTruthy();
    expect(screen.queryByText("68%")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss update notification" })).toBeNull();
  });

  it("shows a ready reminder when the restart prompt is closed", () => {
    updaterMocks.phase = "ready";
    updaterMocks.restartPromptOpen = false;

    render(<UpdateNotificationCard />);

    expect(screen.getByLabelText("Desktop update is ready to install")).toBeTruthy();
    expect(screen.getByText("Update ready")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(updaterMocks.openRestartPrompt).toHaveBeenCalledTimes(1);
  });

  it("does not render the ready reminder behind the restart prompt", () => {
    updaterMocks.phase = "ready";
    updaterMocks.restartPromptOpen = true;

    render(<UpdateNotificationCard />);

    expect(screen.queryByLabelText("Desktop update is ready to install")).toBeNull();
  });

  it("does not render when no update is available", () => {
    updaterMocks.phase = "current";

    render(<UpdateNotificationCard />);

    expect(screen.queryByText("Update available")).toBeNull();
  });
});
