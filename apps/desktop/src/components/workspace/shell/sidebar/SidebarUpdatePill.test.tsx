/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpdaterPhase } from "@/hooks/access/tauri/use-updater";
import { SidebarUpdatePill } from "./SidebarUpdatePill";

afterEach(cleanup);

function renderPill(
  overrides: Partial<{
    phase: UpdaterPhase;
    downloadProgress: number | null;
    restartWhenIdle: boolean;
    onDownloadUpdate: () => void;
    onOpenRestartPrompt: () => void;
  }> = {},
) {
  const props = {
    phase: "available" as UpdaterPhase,
    downloadProgress: null,
    restartWhenIdle: false,
    onDownloadUpdate: vi.fn(),
    onOpenRestartPrompt: vi.fn(),
    ...overrides,
  };
  const view = render(<SidebarUpdatePill {...props} />);
  return { ...view, props };
}

function progressArc(): SVGCircleElement {
  const arc = document.querySelector<SVGCircleElement>(
    '[data-testid="update-pill-progress-arc"]',
  );
  if (!arc) {
    throw new Error("progress arc not rendered");
  }
  return arc;
}

describe("SidebarUpdatePill", () => {
  it("renders nothing outside the available/downloading/ready phases", () => {
    for (const phase of ["idle", "checking", "current", "error"] as const) {
      const { unmount } = renderPill({ phase });
      expect(screen.queryByRole("button")).toBeNull();
      unmount();
    }
  });

  it("labels each phase with the canonical copy", () => {
    const cases: { phase: UpdaterPhase; restartWhenIdle?: boolean; label: string }[] = [
      { phase: "available", label: "Download update" },
      { phase: "downloading", label: "Downloading" },
      { phase: "ready", label: "Restart to update" },
      { phase: "ready", restartWhenIdle: true, label: "Restarting when idle" },
    ];
    for (const { phase, restartWhenIdle = false, label } of cases) {
      const { unmount } = renderPill({ phase, restartWhenIdle });
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
      unmount();
    }
  });

  it("starts the download when clicked while available", () => {
    const { props } = renderPill({ phase: "available" });

    fireEvent.click(screen.getByRole("button", { name: "Download update" }));

    expect(props.onDownloadUpdate).toHaveBeenCalledTimes(1);
    expect(props.onOpenRestartPrompt).not.toHaveBeenCalled();
  });

  it("drives the progress ring from the real download percentage", () => {
    renderPill({ phase: "downloading", downloadProgress: 68 });

    // pathLength=100 maps dashoffset 1:1 to the remaining percentage.
    expect(progressArc().getAttribute("stroke-dashoffset")).toBe("32");
  });

  it("clamps ring progress to the 0-100 range and treats null as empty", () => {
    const { rerender, props } = renderPill({ phase: "downloading", downloadProgress: null });
    expect(progressArc().getAttribute("stroke-dashoffset")).toBe("100");

    rerender(<SidebarUpdatePill {...props} downloadProgress={250} />);
    expect(progressArc().getAttribute("stroke-dashoffset")).toBe("0");
  });

  it("is not clickable while downloading", () => {
    const { props } = renderPill({ phase: "downloading", downloadProgress: 10 });

    const pill = screen.getByRole("button", { name: "Downloading" });
    fireEvent.click(pill);

    expect((pill as HTMLButtonElement).disabled).toBe(true);
    expect(props.onDownloadUpdate).not.toHaveBeenCalled();
    expect(props.onOpenRestartPrompt).not.toHaveBeenCalled();
  });

  it("opens the restart prompt when clicked while ready", () => {
    const { props } = renderPill({ phase: "ready" });

    fireEvent.click(screen.getByRole("button", { name: "Restart to update" }));

    expect(props.onOpenRestartPrompt).toHaveBeenCalledTimes(1);
    expect(props.onDownloadUpdate).not.toHaveBeenCalled();
  });

  it("plays the one-shot sweep on entry into ready", () => {
    const { rerender, props } = renderPill({ phase: "downloading", downloadProgress: 90 });
    expect(document.querySelector('[data-testid="update-pill-ready-sweep"]')).toBeNull();

    rerender(<SidebarUpdatePill {...props} phase="ready" />);

    expect(document.querySelector('[data-testid="update-pill-ready-sweep"]')).toBeTruthy();
  });

  it("keeps the armed variant subdued: no sweep, muted text, restart prompt on click", () => {
    const { props } = renderPill({ phase: "ready", restartWhenIdle: true });

    const pill = screen.getByRole("button", { name: "Restarting when idle" });
    expect(document.querySelector('[data-testid="update-pill-ready-sweep"]')).toBeNull();
    expect(pill.className).toContain("text-muted-foreground");

    fireEvent.click(pill);
    expect(props.onOpenRestartPrompt).toHaveBeenCalledTimes(1);
  });

  it("stops the sweep when the deferred restart is armed", () => {
    const { rerender, props } = renderPill({ phase: "ready" });
    expect(document.querySelector('[data-testid="update-pill-ready-sweep"]')).toBeTruthy();

    rerender(<SidebarUpdatePill {...props} phase="ready" restartWhenIdle={true} />);

    expect(document.querySelector('[data-testid="update-pill-ready-sweep"]')).toBeNull();
  });
});
