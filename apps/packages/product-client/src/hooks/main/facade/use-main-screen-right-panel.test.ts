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
function fireDrag(onMouseDown: (event: ReactMouseEvent) => void, deltas: number[]) {
  const preventDefault = () => {};
  const stopPropagation = () => {};
  act(() => {
    onMouseDown(
      { clientX: 0, preventDefault, stopPropagation } as unknown as ReactMouseEvent,
    );
  });
  for (const delta of deltas) {
    act(() => {
      // Reverse direction (right panel is anchored to the right edge): a
      // positive delta here is the same "drag left to widen" motion
      // `handleRightPanelDrag`'s `reverse: true` expects.
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: -delta }));
    });
  }
  act(() => {
    document.dispatchEvent(new MouseEvent("mouseup"));
  });
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
});
