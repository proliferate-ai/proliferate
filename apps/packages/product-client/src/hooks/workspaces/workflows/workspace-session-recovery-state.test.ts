import { beforeEach, describe, expect, it } from "vitest";
import {
  clearWorkspaceBootstrappedInSession,
  hasWorkspaceBootstrappedInSession,
} from "#product/hooks/workspaces/lifecycle/workspace-bootstrap-memory";
import {
  enterWorkspaceSessionRecovery,
} from "#product/hooks/workspaces/workflows/workspace-session-recovery-state";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

describe("enterWorkspaceSessionRecovery", () => {
  beforeEach(() => {
    clearWorkspaceBootstrappedInSession("workspace-1");
    useSessionSelectionStore.getState().clearSelection();
  });

  it("anchors inline failure to the retained selected session surface", () => {
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: "logical-workspace-1",
      workspaceId: "workspace-1",
      initialActiveSessionId: "client-session:claude:recovery",
    });

    expect(enterWorkspaceSessionRecovery(
      "workspace-1",
      "logical-workspace-1",
      "session-list-failed",
    )).toBe(true);

    expect(useSessionSelectionStore.getState()).toMatchObject({
      activeSessionId: "client-session:claude:recovery",
      workspaceSessionRecovery: {
        workspaceId: "workspace-1",
        logicalWorkspaceId: "logical-workspace-1",
        sessionId: "client-session:claude:recovery",
        reason: "session-list-failed",
      },
    });
    expect(hasWorkspaceBootstrappedInSession("workspace-1")).toBe(true);
  });
});
