/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { motion } from "@proliferate/design/motion";
import { WorkspaceShellSidebar } from "#product/components/workspace/shell/sidebar/WorkspaceShellSidebar";

vi.mock("#product/components/diagnostics/DebugProfiler", () => ({
  DebugProfiler: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("#product/components/workspace/shell/sidebar/MainSidebar", () => ({
  MainSidebar: ({
    showRightBorder,
    glassBackground,
  }: {
    showRightBorder?: boolean;
    glassBackground?: boolean;
  }) => (
    <div
      data-testid="main-sidebar-body"
      data-show-right-border={showRightBorder ? "true" : "false"}
      data-glass-background={glassBackground ? "true" : "false"}
    >
      <button type="button">Main navigation item</button>
    </div>
  ),
}));

vi.mock("#product/components/workspace/shell/sidebar/WorkspaceSidebarHeaderControls", () => ({
  WorkspaceSidebarHeaderControls: ({
    onToggleSidebar,
  }: {
    onToggleSidebar: () => void;
  }) => (
    <button data-testid="sidebar-header-controls" onClick={onToggleSidebar}>
      Toggle
    </button>
  ),
}));

vi.mock("#product/components/app/sidebar/SidebarUpdateFooterButton", () => ({
  SidebarUpdateFooterButton: () => <div data-testid="sidebar-update-control" />,
}));

const coarsePointer = vi.hoisted(() => ({ value: false }));

vi.mock("#product/hooks/ui/layout/use-coarse-pointer", () => ({
  useCoarsePointer: () => coarsePointer.value,
}));

function renderSidebar(
  open = false,
  onToggleSidebar: (options?: { snapGeometry?: boolean }) => void = () => {},
  showAnimatedDivider = false,
) {
  const result = render(
    <WorkspaceShellSidebar
      open={open}
      width={280}
      showAnimatedDivider={showAnimatedDivider}
      onToggleSidebar={onToggleSidebar}
    />,
  );
  const panel = document.getElementById("main-sidebar");
  if (!panel) {
    throw new Error("sidebar panel did not render");
  }
  const trigger = document.querySelector("[data-sidebar-peek-trigger]");
  if (!trigger) {
    throw new Error("peek trigger did not render");
  }
  const holdZone = document.querySelector("[data-sidebar-peek-hold-zone]");
  if (!holdZone) {
    throw new Error("peek hold zone did not render");
  }
  return { ...result, panel, trigger, holdZone };
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
    coarsePointer.value = false;
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
   * The grace period lets the pointer travel from the panel into persistent
   * window chrome without starting a visible close/reopen cycle.
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

  it("finishes the peek exit after the grace and exit durations", () => {
    const { panel, trigger } = renderSidebar();
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(panel);

    act(() => {
      vi.advanceTimersByTime(motion.delay.hoverCardHideMs);
    });

    expect(peekState(panel)).toBe("closing");

    act(() => {
      vi.advanceTimersByTime(motion.duration.exitMs);
    });
    expect(peekState(panel)).toBe("closed");
  });

  it("does not arm from the pinned toggle or header hold zone", () => {
    const { panel, holdZone, getByTestId } = renderSidebar();

    fireEvent.mouseEnter(holdZone);
    fireEvent.mouseEnter(getByTestId("sidebar-header-controls"));

    expect(peekState(panel)).toBe("closed");
  });

  it("centers the pinned toggle in the shared title row", () => {
    const { getByTestId, holdZone } = renderSidebar();
    const pinnedChrome = getByTestId("sidebar-header-controls").parentElement?.parentElement;

    expect(pinnedChrome?.className).toContain("top-0");
    expect(pinnedChrome?.className).toContain("h-[46px]");
    expect(holdZone.className).toContain("h-[46px]");
  });

  it("keeps the pinned toggle before sidebar navigation in keyboard order", () => {
    const { getAllByRole, getByRole, getByTestId } = renderSidebar(true);
    const buttons = getAllByRole("button");

    expect(buttons.indexOf(getByTestId("sidebar-header-controls")))
      .toBeLessThan(buttons.indexOf(getByRole("button", { name: "Main navigation item" })));
  });

  it("renders a full-height divider at the animated edge when requested", () => {
    renderSidebar(true, () => {}, true);
    const divider = document.querySelector("[data-workspace-left-divider]");

    expect(divider).not.toBeNull();
    expect(divider?.className).toContain("inset-y-0");
    expect(divider?.getAttribute("style")).toContain("--workspace-left-width");
  });

  it("leaves the full-height workspace shell as the open divider owner", () => {
    const { getByTestId } = renderSidebar(true);

    expect(getByTestId("main-sidebar-body").getAttribute("data-show-right-border"))
      .toBe("false");
  });

  it("lets the header hold zone cancel a peek that is mid-fade-out", () => {
    const { panel, trigger, holdZone } = renderSidebar();
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(panel);
    act(() => {
      vi.advanceTimersByTime(motion.delay.hoverCardHideMs);
    });
    expect(peekState(panel)).toBe("closing");

    fireEvent.mouseEnter(holdZone);

    expect(peekState(panel)).toBe("open");
    expect(panel.className).toContain("translate-x-0");
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

  it("fades in place during toggle-close, then restores the peek offset", () => {
    const { panel, rerender } = renderSidebar(true);

    rerender(<WorkspaceShellSidebar open={false} width={280} onToggleSidebar={() => {}} />);

    expect(peekState(panel)).toBe("toggle-closing");
    expect(panel.className).toContain("translate-x-0");
    expect(panel.className).not.toContain("-translate-x-2");
    expect(panel.className).toContain("transition-opacity");

    act(() => {
      vi.advanceTimersByTime(motion.duration.panelMs);
    });

    expect(peekState(panel)).toBe("closed");
    expect(panel.className).toContain("-translate-x-2");
  });

  it("repaints the peek offset before peeking immediately after a toggle-close", () => {
    const { panel, trigger, rerender } = renderSidebar(true);
    rerender(<WorkspaceShellSidebar open={false} width={280} onToggleSidebar={() => {}} />);

    fireEvent.mouseEnter(trigger);
    expect(peekState(panel)).toBe("preparing");
    expect(panel.className).toContain("transition-none");
    expect(panel.className).toContain("-translate-x-2");

    act(() => {
      vi.advanceTimersByTime(40);
    });

    expect(peekState(panel)).toBe("open");
    expect(panel.className).toContain("translate-x-0");
    expect(panel.className).toContain("duration-panel");
  });

  it("requests a geometry snap when the persistent toggle pins a peek", () => {
    const onToggleSidebar = vi.fn();
    const { panel, trigger, getByTestId } = renderSidebar(false, onToggleSidebar);
    fireEvent.mouseEnter(trigger);
    expect(peekState(panel)).toBe("open");

    fireEvent.click(getByTestId("sidebar-header-controls"));

    expect(onToggleSidebar).toHaveBeenCalledWith({ snapGeometry: true });
  });

  it("keeps a mid-exit peek fully visible when pinning snaps it open", () => {
    const onToggleSidebar = vi.fn();
    const { panel, trigger, getByTestId, rerender } = renderSidebar(false, onToggleSidebar);
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(panel);
    act(() => {
      vi.advanceTimersByTime(motion.delay.hoverCardHideMs);
    });
    expect(peekState(panel)).toBe("closing");

    fireEvent.click(getByTestId("sidebar-header-controls"));
    expect(onToggleSidebar).toHaveBeenCalledWith({ snapGeometry: true });

    rerender(
      <WorkspaceShellSidebar
        open
        width={280}
        snapGeometry
        onToggleSidebar={onToggleSidebar}
      />,
    );
    expect(peekState(panel)).toBe("inactive");
    expect(panel.className).toContain("opacity-100");
    expect(panel.className).toContain("transition-none");
    expect(panel.className).not.toContain("duration-enter");
  });

  it("keeps the collapsed panel out of the tab order until it peeks", () => {
    const { panel, trigger } = renderSidebar();
    expect(panel.hasAttribute("inert")).toBe(true);

    fireEvent.mouseEnter(trigger);

    expect(panel.hasAttribute("inert")).toBe(false);
  });

  /**
   * A touch tap fires a synthetic `mouseenter` with no matching `mouseleave`
   * once the finger lifts, so a coarse pointer that reached this handler would
   * arm the peek and then have no gesture available to close it again. The
   * hook is expected to refuse to arm at all on such a device, rather than
   * open and then rely on some other close path a touch device doesn't have.
   */
  it("never arms the peek on a coarse (touch) pointer", () => {
    coarsePointer.value = true;
    const { panel, trigger } = renderSidebar();

    fireEvent.mouseEnter(trigger);
    expect(peekState(panel)).toBe("closed");

    fireEvent.mouseEnter(panel);
    expect(peekState(panel)).toBe("closed");
  });
});

describe("WorkspaceShellSidebar glass background", () => {
  afterEach(() => {
    cleanup();
  });

  function renderGlassSidebar(open: boolean) {
    render(
      <WorkspaceShellSidebar
        open={open}
        width={280}
        glassBackground
        onToggleSidebar={() => {}}
      />,
    );
    const panel = document.getElementById("main-sidebar");
    if (!panel) {
      throw new Error("sidebar panel did not render");
    }
    return panel;
  }

  it("paints the docked panel translucent", () => {
    const panel = renderGlassSidebar(true);
    expect(panel.classList.contains("bg-sidebar/60")).toBe(true);
    expect(panel.classList.contains("bg-sidebar")).toBe(false);
  });

  /**
   * The collapsed-hover peek floats the same panel over the content pane,
   * where a translucent fill would bleed chat content through instead of
   * window vibrancy — the peek must stay opaque even in glass mode.
   */
  it("keeps the peek overlay opaque", () => {
    const panel = renderGlassSidebar(false);
    const trigger = document.querySelector("[data-sidebar-peek-trigger]");
    if (!trigger) {
      throw new Error("peek trigger did not render");
    }

    fireEvent.mouseEnter(trigger);

    expect(peekState(panel)).toBe("open");
    expect(panel.classList.contains("bg-sidebar")).toBe(true);
    expect(panel.classList.contains("bg-sidebar/60")).toBe(false);
  });

  it("stays opaque when glass is not requested", () => {
    render(
      <WorkspaceShellSidebar open width={280} onToggleSidebar={() => {}} />,
    );
    const panel = document.getElementById("main-sidebar");
    expect(panel?.classList.contains("bg-sidebar")).toBe(true);
    expect(panel?.classList.contains("bg-sidebar/60")).toBe(false);
  });

  /**
   * The frame inside the panel must cede its background in glass mode — an
   * opaque inner frame paints over the panel's translucency and turns the
   * glass solid again no matter what the panel class says.
   */
  it("forwards glass to the inner sidebar frame", () => {
    renderGlassSidebar(true);
    expect(screen.getByTestId("main-sidebar-body").dataset.glassBackground).toBe("true");
  });

  it("keeps the inner frame opaque when glass is not requested", () => {
    render(
      <WorkspaceShellSidebar open width={280} onToggleSidebar={() => {}} />,
    );
    expect(screen.getByTestId("main-sidebar-body").dataset.glassBackground).toBe("false");
  });
});
