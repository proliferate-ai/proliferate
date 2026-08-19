/* @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useMainScreenRightPanel } from "#product/hooks/main/facade/use-main-screen-right-panel";
import {
  RIGHT_PANEL_COLLAPSE_DRAG_THRESHOLD,
  RIGHT_PANEL_MIN_WIDTH,
} from "#product/lib/domain/workspaces/shell/right-panel-model";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";

const WORKSPACE_ID = "workspace-drag-test";

afterEach(() => {
  cleanup();
  // The right-panel width/open state this suite exercises lives in the real
  // store (not mocked), so it has to be reset by hand between tests or a
  // drag from one test leaks its collapsed/width state into the next.
  useWorkspaceUiStore.setState({
    rightPanelDurableByWorkspace: {},
    rightPanelMaterializedByWorkspace: {},
  });
});

/**
 * Drives `onRightSeparatorDown` through an actual `mousedown` -> `mousemove`
 * (repeated) -> `mouseup` sequence on `document`, the same path a real drag
 * takes through `useResize`. Calling `resolveRightPanelDragOutcome` directly,
 * as the existing domain-level tests do, proves the collapse/resize decision
 * is correct in isolation but not that `onRightSeparatorDown` actually wires
 * a live drag into it — the collapse latch and the reset-on-new-drag are
 * behavior of the hook's glue code, not of that pure function.
 */
function beginDrag(onMouseDown: (event: ReactMouseEvent) => void) {
  const preventDefault = () => {};
  const stopPropagation = () => {};
  act(() => {
    onMouseDown(
      { clientX: 0, preventDefault, stopPropagation } as unknown as ReactMouseEvent,
    );
  });
}

function moveDrag(delta: number) {
  act(() => {
    // Reverse direction (right panel is anchored to the right edge): a
    // positive delta here is the same "drag left to widen" motion
    // `handleRightPanelDrag`'s `reverse: true` expects.
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: -delta }));
  });
}

function releaseDrag() {
  act(() => {
    document.dispatchEvent(new MouseEvent("mouseup"));
  });
}

function fireDrag(onMouseDown: (event: ReactMouseEvent) => void, deltas: number[]) {
  beginDrag(onMouseDown);
  for (const delta of deltas) {
    moveDrag(delta);
  }
  releaseDrag();
}

function renderRightPanel() {
  return renderHook(() =>
    useMainScreenRightPanel({
      workspaceUiKey: WORKSPACE_ID,
      materializedWorkspaceId: WORKSPACE_ID,
      isCloudWorkspaceSelected: false,
      rightPanelSuppressed: false,
    }));
}

describe("useMainScreenRightPanel drag wiring", () => {
  it("seeds a drag from the rendered rail width when the floor clamp holds it below the persisted width", () => {
    // A rail whose rendered width sits below the persisted 700 — the shape
    // the MAIN_PANE_MIN_WIDTH clamp produces on a small window.
    const rail = document.createElement("div");
    rail.setAttribute("data-right-panel-rail", "");
    rail.getBoundingClientRect = () =>
      ({ width: 420 } as DOMRect);
    document.body.appendChild(rail);

    try {
      const { result, rerender } = renderRightPanel();
      act(() => {
        result.current.setRightPanelOpen(true);
      });
      act(() => {
        result.current.setRightPanelWidth(700);
      });
      rerender();

      // Drag 30px narrower. Seeded from the rendered 420 this lands at 390;
      // seeded from the persisted 700 it would land at 670 — the first 280px
      // of pointer travel would be dead.
      fireDrag(result.current.onRightSeparatorDown, [-30]);
      rerender();

      expect(result.current.rightPanelWidth).toBe(390);
    } finally {
      rail.remove();
    }
  });

  // 02A `ensureRightPanelWidth` is implemented only as
  // `layout.setRightPanelWidth(current => Math.max(current, minRailWidth))`;
  // this is the canonical functional-setter path that action relies on. The
  // 781/780 and 661/660 rendered `clientWidth` geometry proof itself belongs
  // to the rendered frame/dock and qualification-browser suites, not here.
  it("applies a functional setRightPanelWidth updater against the current width", () => {
    const { result, rerender } = renderRightPanel();
    act(() => {
      result.current.setRightPanelWidth(500);
    });
    rerender();
    expect(result.current.rightPanelWidth).toBe(500);

    act(() => {
      result.current.setRightPanelWidth((current) => Math.max(current, 781));
    });
    rerender();

    expect(result.current.rightPanelWidth).toBe(781);
  });

  it("never shrinks a wider width when the functional updater's floor is lower", () => {
    const { result, rerender } = renderRightPanel();
    act(() => {
      result.current.setRightPanelWidth(900);
    });
    rerender();

    act(() => {
      result.current.setRightPanelWidth((current) => Math.max(current, 660));
    });
    rerender();

    expect(result.current.rightPanelWidth).toBe(900);
  });

  it("lets a drag widen the panel past the legacy ceiling when the window affords it", () => {
    // A wide shell row: the drag's ceiling is the row minus the chat pane's
    // floor (2000 − 440 = 1560), not the legacy fixed 700.
    const row = document.createElement("div");
    row.getBoundingClientRect = () => ({ width: 2000 } as DOMRect);
    const rail = document.createElement("div");
    rail.setAttribute("data-right-panel-rail", "");
    rail.getBoundingClientRect = () => ({ width: 420 } as DOMRect);
    row.appendChild(rail);
    document.body.appendChild(row);

    try {
      const { result, rerender } = renderRightPanel();
      act(() => {
        result.current.setRightPanelOpen(true);
      });
      rerender();

      // Widen by 500 from the rendered 420 → 920, beyond the old 700 cap.
      fireDrag(result.current.onRightSeparatorDown, [500]);
      rerender();

      expect(result.current.rightPanelWidth).toBe(920);
    } finally {
      row.remove();
    }
  });

  it("keeps a sub-threshold rail open while the drag widens it", () => {
    // The floor clamp has rendered the rail at 204 — below the collapse
    // threshold. Seeded there, an outward drag must resize (pinned to the
    // panel's floor), and only an inward shove may close.
    const row = document.createElement("div");
    row.getBoundingClientRect = () => ({ width: 1000 } as DOMRect);
    const rail = document.createElement("div");
    rail.setAttribute("data-right-panel-rail", "");
    rail.getBoundingClientRect = () => ({ width: 204 } as DOMRect);
    row.appendChild(rail);
    document.body.appendChild(row);

    try {
      const { result, rerender } = renderRightPanel();
      act(() => {
        result.current.setRightPanelOpen(true);
      });
      rerender();

      fireDrag(result.current.onRightSeparatorDown, [50]);
      rerender();
      expect(result.current.rightPanelOpen).toBe(true);
      expect(result.current.rightPanelWidth).toBe(RIGHT_PANEL_MIN_WIDTH);

      fireDrag(result.current.onRightSeparatorDown, [-20]);
      rerender();
      expect(result.current.rightPanelOpen).toBe(false);
    } finally {
      row.remove();
    }
  });

  it("caps a widening drag at the chat pane's floor", () => {
    const row = document.createElement("div");
    row.getBoundingClientRect = () => ({ width: 1000 } as DOMRect);
    const rail = document.createElement("div");
    rail.setAttribute("data-right-panel-rail", "");
    rail.getBoundingClientRect = () => ({ width: 420 } as DOMRect);
    row.appendChild(rail);
    document.body.appendChild(row);

    try {
      const { result, rerender } = renderRightPanel();
      act(() => {
        result.current.setRightPanelOpen(true);
      });
      rerender();

      // Asks for 920; the 1000px row only affords 1000 − 440 = 560.
      fireDrag(result.current.onRightSeparatorDown, [500]);
      rerender();

      expect(result.current.rightPanelWidth).toBe(560);
    } finally {
      row.remove();
    }
  });

  it("resizes the panel through a real mousedown/mousemove/mouseup sequence", () => {
    const { result, rerender } = renderRightPanel();
    act(() => {
      result.current.setRightPanelOpen(true);
    });
    rerender();

    fireDrag(result.current.onRightSeparatorDown, [40]);
    rerender();

    // Started at the default width, dragged 40px wider than the minimum drag
    // threshold allows collapsing at, so this reads as a resize, not a close.
    expect(result.current.rightPanelOpen).toBe(true);
    expect(result.current.rightPanelWidth).toBeGreaterThanOrEqual(RIGHT_PANEL_MIN_WIDTH);
  });

  it("collapses the panel once a real drag crosses the collapse threshold", () => {
    const { result, rerender } = renderRightPanel();
    act(() => {
      result.current.setRightPanelOpen(true);
    });
    rerender();

    // Drag the raw width well past the collapse threshold (RIGHT_PANEL_MIN_WIDTH
    // minus more than the 80px of resistance built into the threshold gap).
    const dragPastCollapse = -(RIGHT_PANEL_MIN_WIDTH
      - RIGHT_PANEL_COLLAPSE_DRAG_THRESHOLD
      + 50);
    fireDrag(result.current.onRightSeparatorDown, [dragPastCollapse]);
    rerender();

    expect(result.current.rightPanelOpen).toBe(false);
  });

  it("ignores further movement in the same gesture once collapsed, so a jittery pointer cannot re-expand it", () => {
    const { result, rerender } = renderRightPanel();
    act(() => {
      result.current.setRightPanelOpen(true);
    });
    rerender();

    const collapseDelta = -(RIGHT_PANEL_MIN_WIDTH - RIGHT_PANEL_COLLAPSE_DRAG_THRESHOLD + 50);
    // One continuous gesture: it crosses into collapse, then jitters back
    // toward a resize-worthy width without an intervening mouseup.
    fireDrag(result.current.onRightSeparatorDown, [collapseDelta, 200]);
    rerender();

    expect(result.current.rightPanelOpen).toBe(false);
  });

  it("resets the collapse latch on the next mousedown, so a fresh drag can resize again", () => {
    const { result, rerender } = renderRightPanel();
    act(() => {
      result.current.setRightPanelOpen(true);
    });
    rerender();

    const collapseDelta = -(RIGHT_PANEL_MIN_WIDTH - RIGHT_PANEL_COLLAPSE_DRAG_THRESHOLD + 50);
    fireDrag(result.current.onRightSeparatorDown, [collapseDelta]);
    rerender();
    expect(result.current.rightPanelOpen).toBe(false);

    act(() => {
      result.current.setRightPanelOpen(true);
    });
    rerender();

    fireDrag(result.current.onRightSeparatorDown, [40]);
    rerender();

    expect(result.current.rightPanelOpen).toBe(true);
  });

  it("commits the durable width once on release, not on every mousemove", () => {
    const { result, rerender } = renderRightPanel();
    act(() => {
      result.current.setRightPanelOpen(true);
    });
    rerender();
    const startWidth = result.current.rightPanelWidth;

    beginDrag(result.current.onRightSeparatorDown);
    moveDrag(40);
    rerender();

    // Mid-gesture: the rendered width tracks the pointer and the drag is
    // flagged, but the durable store still holds the pre-drag width — the
    // persistence subscriber must not run per mousemove.
    expect(result.current.rightPanelResizing).toBe(true);
    expect(result.current.rightPanelWidth).toBe(startWidth + 40);
    expect(
      useWorkspaceUiStore.getState().rightPanelDurableByWorkspace[WORKSPACE_ID]?.width,
    ).toBe(startWidth);

    releaseDrag();
    rerender();

    expect(result.current.rightPanelResizing).toBe(false);
    expect(
      useWorkspaceUiStore.getState().rightPanelDurableByWorkspace[WORKSPACE_ID]?.width,
    ).toBe(startWidth + 40);
  });

  it("ends the resize at the collapse itself and commits no width for a collapse-only gesture", () => {
    const { result, rerender } = renderRightPanel();
    act(() => {
      result.current.setRightPanelOpen(true);
    });
    rerender();
    const startWidth = result.current.rightPanelWidth;
    const collapseDelta = -(RIGHT_PANEL_MIN_WIDTH - RIGHT_PANEL_COLLAPSE_DRAG_THRESHOLD + 50);

    beginDrag(result.current.onRightSeparatorDown);
    moveDrag(collapseDelta);
    rerender();

    // Resizing ends at the collapse, before the mouse is released, so the
    // close gets its eased geometry back instead of snapping shut.
    expect(result.current.rightPanelOpen).toBe(false);
    expect(result.current.rightPanelResizing).toBe(false);

    releaseDrag();
    rerender();

    // Reopening restores the width from before the drag.
    expect(
      useWorkspaceUiStore.getState().rightPanelDurableByWorkspace[WORKSPACE_ID]?.width,
    ).toBe(startWidth);
  });
});

describe("useMainScreenRightPanel external durable open writes", () => {
  it("honors a store-level open written while a session override holds the frame closed (PRO-242)", () => {
    const { result, rerender } = renderRightPanel();
    // A toggle seeds the session override; closing leaves it at open:false,
    // which used to shadow every later store-level open write.
    act(() => {
      result.current.setRightPanelOpen(true);
    });
    act(() => {
      result.current.setRightPanelOpen(false);
    });
    rerender();
    expect(result.current.rightPanelOpen).toBe(false);

    // A chat file-link click opens the frame through the store, the same
    // write `openViewerTargetInRightPanel` issues.
    act(() => {
      useWorkspaceUiStore.getState().setRightPanelOpenForWorkspace(WORKSPACE_ID, true);
    });
    rerender();
    expect(result.current.rightPanelOpen).toBe(true);

    // The user can still close it afterwards.
    act(() => {
      result.current.setRightPanelOpen(false);
    });
    rerender();
    expect(result.current.rightPanelOpen).toBe(false);
  });

  it("keeps the frame shell-level on workspace switches instead of adopting the next workspace's persisted open", () => {
    const OTHER_WORKSPACE_ID = "workspace-switch-test";
    const { result, rerender } = renderHook(
      ({ workspaceUiKey }: { workspaceUiKey: string }) =>
        useMainScreenRightPanel({
          workspaceUiKey,
          materializedWorkspaceId: workspaceUiKey,
          isCloudWorkspaceSelected: false,
          rightPanelSuppressed: false,
        }),
      { initialProps: { workspaceUiKey: WORKSPACE_ID } },
    );
    act(() => {
      result.current.setRightPanelOpen(true);
    });
    act(() => {
      useWorkspaceUiStore.getState().setRightPanelOpenForWorkspace(OTHER_WORKSPACE_ID, false);
    });

    rerender({ workspaceUiKey: OTHER_WORKSPACE_ID });
    expect(result.current.rightPanelOpen).toBe(true);
  });
});
