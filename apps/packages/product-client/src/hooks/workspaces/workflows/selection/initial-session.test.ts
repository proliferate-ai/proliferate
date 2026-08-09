import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_UI_DEFAULTS } from "#product/lib/domain/preferences/workspace-ui/model";
import { chatWorkspaceShellTabKey } from "#product/lib/domain/workspaces/tabs/shell-tabs";
import {
  prepareOptimisticWorkspaceSessionShell,
  resolveInitialActiveSessionId,
  type InitialSessionRecordDeps,
} from "#product/hooks/workspaces/workflows/selection/initial-session";
import { writeChatShellIntentForSession } from "#product/hooks/workspaces/workflows/tabs/workspace-shell-intent-writer";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
  patchSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

const logLatency = vi.fn();
const deps: InitialSessionRecordDeps = {
  createEmptySessionRecord,
  getSessionRecord,
  logLatency,
  patchSessionRecord,
  putSessionRecord,
  writeChatShellIntentForSession,
};

beforeEach(() => {
  logLatency.mockReset();
  useSessionDirectoryStore.getState().clearEntries();
  useSessionTranscriptStore.getState().clearEntries();
  useSessionSelectionStore.getState().clearSelection();
  useWorkspaceUiStore.setState({
    ...WORKSPACE_UI_DEFAULTS,
    _hydrated: true,
    shellActivationEpochByWorkspace: {},
    pendingChatActivationByWorkspace: {},
  });
  useSessionSelectionStore.getState().activateWorkspace({
    logicalWorkspaceId: "logical:workspace-1",
    workspaceId: "workspace-1",
  });
});

describe("initial session projection", () => {
  it("repeatedly restores a materialized identity by focusing its existing client tab", () => {
    putSessionRecord(createEmptySessionRecord("client-session:codex:1", "codex", {
      materializedSessionId: "runtime-session-1",
      workspaceId: "workspace-1",
    }));
    putSessionRecord(createEmptySessionRecord("client-session:codex:2", "codex", {
      materializedSessionId: "runtime-session-2",
      workspaceId: "workspace-1",
    }));
    const input = {
      workspaceId: "workspace-1",
      workspaceUiKey: "logical:workspace-1",
      workspaceUiKeys: ["logical:workspace-1"],
      options: undefined,
      workspaceUiState: {
        lastViewedSessionByWorkspace: {
          "logical:workspace-1": "runtime-session-2",
        },
        visibleChatSessionIdsByWorkspace: {},
      },
      clientSessionIdByMaterializedSessionId:
        useSessionDirectoryStore.getState().clientSessionIdByMaterializedSessionId,
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const sessionId = resolveInitialActiveSessionId(input, deps);
      expect(sessionId).toBe("client-session:codex:2");
      prepareOptimisticWorkspaceSessionShell({
        sessionId,
        workspaceId: "workspace-1",
        workspaceUiKey: "logical:workspace-1",
      }, deps);
    }

    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace["logical:workspace-1"])
      .toBe(chatWorkspaceShellTabKey("client-session:codex:2"));
    expect(Object.keys(useSessionDirectoryStore.getState().entriesById).sort()).toEqual([
      "client-session:codex:1",
      "client-session:codex:2",
    ]);
    expect(getSessionRecord("runtime-session-2")).toBeNull();
  });
});
