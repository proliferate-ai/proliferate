/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { motion } from "@proliferate/design/motion";
import { WorkspaceShellSidebar } from "#product/components/workspace/shell/sidebar/WorkspaceShellSidebar";

vi.mock("#product/components/diagnostics/DebugProfiler", () => ({
  DebugProfiler: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("#product/components/workspace/shell/sidebar/MainSidebar", () => ({
  MainSidebar: () => <div data-testid="main-sidebar-body" />,
}));

vi.mock("#product/components/workspace/shell/sidebar/WorkspaceSidebarHeaderControls", () => ({
  WorkspaceSidebarHeaderControls: () => <div data-testid="sidebar-header-controls" />,
}));

function renderSidebar(open = false) {
  const result = render(
    <WorkspaceShellSidebar open={open} width={280} onToggleSidebar={() => {}} />,
  );
  const panel = document.getElementById("main-sidebar");
  if (!panel) {
    throw new Error("sidebar panel did not render");
  }
  const trigger = document.querySelector("[data-sidebar-peek-trigger]");
  if (!trigger) {
    throw new Error("peek trigger did not render");
  }
  return { ...result, panel, trigger };
}

function peekState(panel: HTMLElement): string | null {
  return panel.getAttribute("data-sidebar-peek");
}

describe("WorkspaceShellSidebar hover peek", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("arms the peek immediately on the edge trigger", () => {
    const { panel, trigger } = renderSidebar();
    expect(peekState(panel)).toBe("closed");

    fireEvent.mouseEnter(trigger);

    // Opening is never deferred: a grace period on the way IN would make the
    // sidebar feel like it was deciding whether to respond.
    expect(peekState(panel)).toBe("open");
  });

  /**
   * The whole point of the grace period. The collapsed layout puts the "Show
   * sidebar" toggle in the header, OUTSIDE the peeked panel, so travelling to it
   * fires `mouseleave` on the panel. Closing on that instant meant the panel
   * faded out and the resulting click faded it straight back in — two
   * animations for one gesture.
   */
  it("keeps the peek open across a brief exit and re-entry", () => {
    const { panel, trigger } = renderSidebar();
    fireEvent.mouseEnter(trigger);
    expect(peekState(panel)).toBe("open");

    fireEvent.mouseLeave(panel);
    // Still open: the close is only scheduled.
    expect(peekState(panel)).toBe("open");

    act(() => {
      vi.advanceTimersByTime(motion.delay.hoverCardHideMs - 1);
    });
    expect(peekState(panel)).toBe("open");

    fireEvent.mouseEnter(panel);
    act(() => {
      vi.advanceTimersByTime(motion.delay.hoverCardHideMs * 4);
    });
    // Re-entry inside the grace period cancels the close outright, so the panel
    // never animated at all.
    expect(peekState(panel)).toBe("open");
  });

  it("closes the peek once the grace period elapses", () => {
    const { panel, trigger } = renderSidebar();
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(panel);

    act(() => {
      vi.advanceTimersByTime(motion.delay.hoverCardHideMs);
    });

    expect(peekState(panel)).toBe("closed");
  });

  /**
   * Opacity alone reads as a pop however long it runs: the panel is a
   * full-height slab, so with nothing moving there is no direction to the
   * reveal. The transition must therefore cover `translate` — Tailwind's
   * translate utilities compile to the standalone `translate` property, so a
   * transition naming `transform` animates nothing and the slide snaps.
   */
  it("transitions opacity and translate together, and offsets the hidden panel", () => {
    const { panel, trigger } = renderSidebar();

    expect(panel.className).toContain("transition-[opacity,translate]");
    expect(panel.className).toContain("-translate-x-2");
    expect(panel.className).not.toContain("transition-opacity");

    fireEvent.mouseEnter(trigger);

    expect(panel.className).toContain("translate-x-0");
    expect(panel.className).not.toContain("-translate-x-2");
  });

  /**
   * `out-quint` covers ~86% of its distance in the first third of the duration,
   * so at any duration the eye reads arrival rather than travel. The peek uses
   * the `panel` geometry budget with `out-cubic`, which spends it on a quick
   * departure that decelerates into place.
   */
  it("arrives on the panel duration and the out-cubic curve", () => {
    const { panel, trigger } = renderSidebar();
    fireEvent.mouseEnter(trigger);

    expect(panel.className).toContain("duration-panel");
    expect(panel.className).toContain("ease-out-cubic");
    expect(panel.className).not.toContain("ease-out-quint");
  });

  it("leaves on the faster exit duration", () => {
    const { panel } = renderSidebar();

    expect(panel.className).toContain("duration-exit");
    expect(panel.className).toContain("ease-out-cubic");
  });

  it("drops a pending close when the sidebar is opened", () => {
    const { panel, trigger, rerender } = renderSidebar();
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(panel);

    rerender(<WorkspaceShellSidebar open width={280} onToggleSidebar={() => {}} />);
    act(() => {
      vi.advanceTimersByTime(motion.delay.hoverCardHideMs * 4);
    });

    // Open, peek is not a state the panel can be in; re-collapsing later must
    // start from hidden rather than inheriting this hover.
    expect(peekState(panel)).toBe("inactive");
    expect(panel.className).toContain("opacity-100");
  });

  it("keeps the collapsed panel out of the tab order until it peeks", () => {
    const { panel, trigger } = renderSidebar();
    expect(panel.hasAttribute("inert")).toBe(true);

    fireEvent.mouseEnter(trigger);

    expect(panel.hasAttribute("inert")).toBe(false);
  });
});
