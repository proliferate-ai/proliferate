// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRightPanelLifecycle } from "#product/hooks/workspaces/lifecycle/right-panel/use-right-panel-lifecycle";
import type {
  RightPanelHeaderEntryKey,
  RightPanelWorkspaceState,
} from "#product/lib/domain/workspaces/shell/right-panel-model";

// The run-scoped reconciliation is only observable with the launch gate on:
// with it off the header order carries no `tool:workflow` key to reconcile.
vi.mock("#product/lib/domain/capabilities/workflows-v2", () => ({
  isWorkflowsV2Enabled: () => true,
}));

const HEADER_ORDER: RightPanelHeaderEntryKey[] = [
  "tool:scratch",
  "tool:git",
  "tool:agents",
  "tool:workflow",
];

function renderLifecycle({
  state,
  hasWorkflowRun,
}: {
  state: RightPanelWorkspaceState;
  hasWorkflowRun: boolean | undefined;
}) {
  const updateState = vi.fn();
  renderHook(() => useRightPanelLifecycle({
    workspaceId: "workspace-1",
    // Closed panel: the starter-terminal effect stays out of the way, and the
    // reconciliation under test does not depend on the panel being open.
    isOpen: false,
    shouldRenderContent: true,
    isCloudWorkspaceSelected: false,
    state,
    terminals: [],
    terminalsQueryIsSuccess: true,
    visibleTerminalCount: 0,
    activeTerminalId: null,
    openViewerTargets: [],
    hasWorkflowRun,
    terminalActivationRequest: null,
    updateState,
    setActiveTerminalForWorkspace: vi.fn(),
    createTerminal: vi.fn(async () => null),
    activateTerminalTool: vi.fn(async () => {}),
    onTerminalActivationRequestHandled: vi.fn(),
  }));
  return updateState;
}

afterEach(() => {
  cleanup();
});

describe("useRightPanelLifecycle workflow-tool reconciliation", () => {
  it("leaves the active workflow tool alone while the runs list is still loading", () => {
    const updateState = renderLifecycle({
      state: { activeEntryKey: "tool:workflow", headerOrder: HEADER_ORDER },
      hasWorkflowRun: undefined,
    });

    // Not "bounced back later" — never touched: a boot tick must not move the
    // user off the tool they opened.
    expect(updateState).not.toHaveBeenCalled();
  });

  it("falls the active workflow tool back to scratch once a settled list shows no run", () => {
    const updateState = renderLifecycle({
      state: { activeEntryKey: "tool:workflow", headerOrder: HEADER_ORDER },
      hasWorkflowRun: false,
    });

    expect(updateState).toHaveBeenCalledTimes(1);
    expect(updateState).toHaveBeenCalledWith({
      activeEntryKey: "tool:scratch",
      headerOrder: HEADER_ORDER,
    });
  });

  it("leaves the active workflow tool alone while the workspace has a run", () => {
    const updateState = renderLifecycle({
      state: { activeEntryKey: "tool:workflow", headerOrder: HEADER_ORDER },
      hasWorkflowRun: true,
    });

    expect(updateState).not.toHaveBeenCalled();
  });

  it("does not disturb another active tool when there is no run (negative control)", () => {
    const updateState = renderLifecycle({
      state: { activeEntryKey: "tool:git", headerOrder: HEADER_ORDER },
      hasWorkflowRun: false,
    });

    expect(updateState).not.toHaveBeenCalled();
  });
});
