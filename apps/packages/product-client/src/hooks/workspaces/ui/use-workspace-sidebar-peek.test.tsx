/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { motion } from "@proliferate/design/motion";
import { useWorkspaceSidebarPeek } from "#product/hooks/workspaces/ui/use-workspace-sidebar-peek";

vi.mock("#product/hooks/ui/layout/use-coarse-pointer", () => ({
  useCoarsePointer: () => false,
}));

function stubReducedMotion(matches: boolean): void {
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

describe("useWorkspaceSidebarPeek", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("owns the open, exit, and pin-from-exit transitions", () => {
    const onToggleSidebar = vi.fn();
    const { result } = renderHook(() => useWorkspaceSidebarPeek({
      open: false,
      onToggleSidebar,
    }));

    act(() => result.current.activatePeek());
    expect(result.current.peekState).toBe("open");

    act(() => result.current.deactivatePeek());
    act(() => vi.advanceTimersByTime(motion.delay.hoverCardHideMs));
    expect(result.current.peekState).toBe("closing");

    act(() => result.current.handleToggleSidebar());
    expect(onToggleSidebar).toHaveBeenCalledWith({ snapGeometry: true });
  });

  it("skips JS-managed presence phases with reduced motion", () => {
    stubReducedMotion(true);
    const onToggleSidebar = vi.fn();
    const { result, rerender } = renderHook(
      ({ open }) => useWorkspaceSidebarPeek({ open, onToggleSidebar }),
      { initialProps: { open: true } },
    );

    rerender({ open: false });
    expect(result.current.toggleClosing).toBe(false);

    act(() => result.current.activatePeek());
    expect(result.current.peekState).toBe("open");
    expect(result.current.peekPreparing).toBe(false);

    act(() => result.current.deactivatePeek());
    act(() => vi.advanceTimersByTime(motion.delay.hoverCardHideMs));
    expect(result.current.peekState).toBe("closed");
    expect(result.current.peekVisible).toBe(false);
  });
});
