import {
  WORKSPACE_SIDEBAR_MIN_WIDTH,
  clampWorkspaceSidebarWidth,
} from "#product/lib/domain/preferences/workspace-ui/sidebar";
import {
  RIGHT_PANEL_MIN_WIDTH,
  clampRightPanelWidth,
} from "#product/lib/domain/workspaces/shell/right-panel-model";

/**
 * The narrowest useful center pane in the standard workspace shell.
 *
 * The desktop window itself bottoms out at 1024px. Reserving 420px for the
 * center alongside the two open-rail minima (220px + 380px) fits that window
 * with 4px to spare. Below that physical envelope, the rails compress in a
 * deterministic ratio before the center gives up its budget.
 */
export const WORKSPACE_MAIN_MIN_WIDTH = 420;

export type WorkspaceShellResizeEdge = "left" | "right";

export interface WorkspaceShellSizingInput {
  containerWidth: number | null;
  leftWidth: number;
  rightWidth: number;
  /**
   * Which rail receives discretionary space first. Passive layout favors the
   * primary navigation on the left; a live drag favors the edge under the
   * pointer so the other rail yields before the dragged edge does.
   */
  priority?: WorkspaceShellResizeEdge;
}

export interface WorkspaceShellSizing {
  left: number;
  right: number;
}

function normalizeUnmeasuredWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) {
    return 0;
  }
  return width;
}

/**
 * Derives rendered rail widths without mutating the durable widths the user
 * requested. This is the one place that owns the aggregate shell-width
 * invariant; the individual preference models continue to own their own
 * semantic minima and maxima.
 */
export function resolveWorkspaceShellSizing({
  containerWidth,
  leftWidth,
  rightWidth,
  priority = "left",
}: WorkspaceShellSizingInput): WorkspaceShellSizing {
  const unmeasured = {
    left: normalizeUnmeasuredWidth(leftWidth),
    right: normalizeUnmeasuredWidth(rightWidth),
  };

  // Before the shell mounts there is no trustworthy container measurement.
  // Preserve the requested geometry until the layout effect supplies one.
  if (containerWidth === null || !Number.isFinite(containerWidth) || containerWidth <= 0) {
    return unmeasured;
  }

  const requested = {
    left: unmeasured.left > 0 ? clampWorkspaceSidebarWidth(unmeasured.left) : 0,
    right: unmeasured.right > 0 ? clampRightPanelWidth(unmeasured.right) : 0,
  };

  const sideBudget = Math.max(0, containerWidth - WORKSPACE_MAIN_MIN_WIDTH);
  if (requested.left + requested.right <= sideBudget) {
    return requested;
  }

  const minimum = {
    left: requested.left > 0 ? WORKSPACE_SIDEBAR_MIN_WIDTH : 0,
    right: requested.right > 0 ? RIGHT_PANEL_MIN_WIDTH : 0,
  };
  const minimumTotal = minimum.left + minimum.right;

  // A window narrower than the normal desktop envelope cannot hold both rail
  // minima and the center floor. Compress the open rails proportionally so the
  // fallback is stable regardless of which edge was most recently dragged.
  if (sideBudget < minimumTotal) {
    if (minimumTotal === 0) {
      return { left: 0, right: 0 };
    }
    const left = Math.floor(sideBudget * (minimum.left / minimumTotal));
    return {
      left,
      right: sideBudget - left,
    };
  }

  const rendered = { ...minimum };
  let discretionaryBudget = sideBudget - minimumTotal;
  const allocationOrder: WorkspaceShellResizeEdge[] = priority === "right"
    ? ["right", "left"]
    : ["left", "right"];

  for (const edge of allocationOrder) {
    const requestedExtra = requested[edge] - minimum[edge];
    const allocatedExtra = Math.min(discretionaryBudget, requestedExtra);
    rendered[edge] += allocatedExtra;
    discretionaryBudget -= allocatedExtra;
  }

  return rendered;
}
