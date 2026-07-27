/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpdaterPhase } from "#product/hooks/access/tauri/use-updater";
import { SidebarUpdateFooterButton } from "#product/components/app/sidebar/SidebarUpdateFooterButton";

const updater = vi.hoisted(() => ({
  phase: "available" as UpdaterPhase,
  restartWhenIdle: false,
  downloadUpdate: vi.fn(),
  openRestartPrompt: vi.fn(),
}));

vi.mock("#product/hooks/access/tauri/use-updater", () => ({
  useUpdater: () => updater,
}));

afterEach(() => {
  cleanup();
  updater.phase = "available";
  updater.restartWhenIdle = false;
  updater.downloadUpdate.mockClear();
  updater.openRestartPrompt.mockClear();
});

describe("SidebarUpdateFooterButton", () => {
  it("renders nothing outside the available/downloading/ready phases", () => {
    for (const phase of ["idle", "checking", "current", "error"] as const) {
      updater.phase = phase;
      const { unmount } = render(<SidebarUpdateFooterButton />);
      expect(screen.queryByRole("button")).toBeNull();
      unmount();
    }
  });

  it("labels each phase without printing progress in the control", () => {
    const cases: { phase: UpdaterPhase; restartWhenIdle?: boolean; label: string }[] = [
      { phase: "available", label: "Download update" },
      { phase: "downloading", label: "Downloading update" },
      { phase: "ready", label: "Restart to update" },
      { phase: "ready", restartWhenIdle: true, label: "Restarting when idle" },
    ];
    for (const { phase, restartWhenIdle = false, label } of cases) {
      updater.phase = phase;
      updater.restartWhenIdle = restartWhenIdle;
      const { unmount } = render(<SidebarUpdateFooterButton />);
      const button = screen.getByRole("button", { name: label });
      // The toast owns progress and phase copy; this control stays a glyph.
      expect(button.textContent).toBe("");
      unmount();
    }
  });

  it("shares the help control's footprint so the footer reads as one row", () => {
    render(<SidebarUpdateFooterButton />);

    const className = screen.getByRole("button").className;
    expect(className).toContain("size-7");
    expect(className).toContain("rounded-md");
    expect(className).toContain("bg-special");
    expect(className).toContain("text-special-foreground");
  });

  it("starts the download while available and reopens the restart prompt when ready", () => {
    render(<SidebarUpdateFooterButton />);
    fireEvent.click(screen.getByRole("button", { name: "Download update" }));
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(updater.openRestartPrompt).not.toHaveBeenCalled();
    cleanup();

    updater.phase = "ready";
    render(<SidebarUpdateFooterButton />);
    fireEvent.click(screen.getByRole("button", { name: "Restart to update" }));
    expect(updater.openRestartPrompt).toHaveBeenCalledTimes(1);
  });

  it("does not accept clicks mid-download", () => {
    updater.phase = "downloading";
    render(<SidebarUpdateFooterButton />);

    const button = screen.getByRole("button", { name: "Downloading update" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.openRestartPrompt).not.toHaveBeenCalled();
  });
});
