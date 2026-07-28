/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpdaterPhase } from "#product/hooks/access/tauri/use-updater";
import { SidebarUpdateFooterButton } from "#product/components/app/sidebar/SidebarUpdateFooterButton";

const updater = vi.hoisted(() => ({
  phase: "available" as UpdaterPhase,
  availableVersion: "0.4.1" as string | null,
  downloadProgress: null as number | null,
  downloadReceivedBytes: null as number | null,
  downloadTotalBytes: null as number | null,
  downloadStartedAt: null as number | null,
  restartWhenIdle: false,
  downloadUpdate: vi.fn(),
  retryDownload: vi.fn(),
  openRestartPrompt: vi.fn(),
}));

vi.mock("#product/hooks/access/tauri/use-updater", () => ({
  useUpdater: () => updater,
}));

afterEach(() => {
  cleanup();
  updater.phase = "available";
  updater.availableVersion = "0.4.1";
  updater.downloadProgress = null;
  updater.downloadReceivedBytes = null;
  updater.downloadTotalBytes = null;
  updater.downloadStartedAt = null;
  updater.restartWhenIdle = false;
  vi.clearAllMocks();
});

describe("SidebarUpdateFooterButton", () => {
  it("renders only when the updater is doing something", () => {
    for (const phase of ["idle", "current"] as const) {
      updater.phase = phase;
      const { unmount } = render(<SidebarUpdateFooterButton />);
      expect(screen.queryByRole("button")).toBeNull();
      unmount();
    }
  });

  it("stays visible while checking, so Check for updates never looks dead", () => {
    updater.phase = "checking";

    render(<SidebarUpdateFooterButton />);

    const button = screen.getByRole("button", { name: "Checking for updates" });
    // Visible but inert: there is nothing to act on mid-check.
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("labels each phase without printing progress in the collapsed control", () => {
    const cases: { phase: UpdaterPhase; restartWhenIdle?: boolean; label: string }[] = [
      { phase: "available", label: "Download update" },
      { phase: "downloading", label: "Downloading update" },
      { phase: "stalled", label: "Download stalled" },
      { phase: "error", label: "Update failed" },
      { phase: "ready", label: "Restart to update" },
      { phase: "ready", restartWhenIdle: true, label: "Restarting when idle" },
    ];
    for (const { phase, restartWhenIdle = false, label } of cases) {
      updater.phase = phase;
      updater.restartWhenIdle = restartWhenIdle;
      const { unmount } = render(<SidebarUpdateFooterButton />);
      const button = screen.getByRole("button", { name: label });
      expect(button.textContent).toBe("");
      unmount();
    }
  });

  it("shares the help control's footprint when collapsed", () => {
    render(<SidebarUpdateFooterButton />);

    const className = screen.getByRole("button").className;
    // A 28px box built from h-7 plus a max-width so the same element can morph
    // wider on hover; `size-7` would pin the width and forbid the expansion.
    expect(className).toContain("h-7");
    expect(className).toContain("max-w-7");
    expect(className).toContain("rounded-md");
    expect(className).toContain("bg-special");
    expect(className).toContain("text-special-foreground");
  });

  it("wears the destructive fill when the flow has gone wrong", () => {
    for (const phase of ["error", "stalled"] as const) {
      updater.phase = phase;
      const { unmount } = render(<SidebarUpdateFooterButton />);
      expect(screen.getByRole("button").className).toContain("bg-destructive");
      unmount();
    }
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

  it("retries from the pill when a download stalled or failed", () => {
    updater.phase = "stalled";

    render(<SidebarUpdateFooterButton />);
    fireEvent.click(screen.getByRole("button", { name: "Download stalled" }));

    expect(updater.retryDownload).toHaveBeenCalledTimes(1);
  });

  it("commits nothing mid-download, but stays hoverable to reveal the estimate", () => {
    updater.phase = "downloading";
    render(<SidebarUpdateFooterButton />);

    const button = screen.getByRole("button", { name: "Downloading update" });
    // Not `disabled`: `pointer-events-none` would suppress hover, and hover is
    // the whole mechanism for revealing the remaining-time estimate.
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.openRestartPrompt).not.toHaveBeenCalled();
  });

  it("morphs on hover to show the version and remaining time", () => {
    updater.phase = "downloading";
    updater.downloadProgress = 50;
    updater.downloadReceivedBytes = 50_000_000;
    updater.downloadTotalBytes = 100_000_000;
    updater.downloadStartedAt = Date.now() - 10_000;

    render(<SidebarUpdateFooterButton />);
    const button = screen.getByRole("button", { name: "Downloading update" });
    expect(button.textContent).toBe("");

    fireEvent.mouseEnter(button);

    expect(button.className).toContain("max-w-[180px]");
    expect(button.textContent).toContain("0.4.1");
    expect(button.textContent).toMatch(/left|almost done/);
  });

  it("draws the ring from the percentage, and pulses when there is no total", () => {
    updater.phase = "downloading";
    updater.downloadProgress = 42;
    const { unmount } = render(<SidebarUpdateFooterButton />);
    const ring = screen.getByTestId("sidebar-update-progress-ring");
    expect(ring.getAttribute("data-progress")).toBe("42");
    // Read the attribute, not `className`: on an SVG element that property is
    // an SVGAnimatedString, so a string assertion against it always passes.
    expect(ring.getAttribute("class")).not.toContain("animate-pulse");
    unmount();

    updater.downloadProgress = null;
    render(<SidebarUpdateFooterButton />);
    const indeterminate = screen.getByTestId("sidebar-update-progress-ring");
    expect(indeterminate.getAttribute("data-progress")).toBe("indeterminate");
    expect(indeterminate.getAttribute("class")).toContain("animate-pulse");
  });
});
