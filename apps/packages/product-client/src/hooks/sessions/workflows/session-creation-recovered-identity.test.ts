import { beforeEach, describe, expect, it } from "vitest";
import { adoptRecoveredSessionIdentity } from "#product/hooks/sessions/workflows/session-creation-recovered-identity";
import { materializeSessionRecord } from "#product/hooks/sessions/workflows/session-creation-local-state";
import { writeChatShellIntentForSession } from "#product/hooks/workspaces/workflows/tabs/workspace-shell-intent-writer";
import { chatWorkspaceShellTabKey } from "#product/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

describe("recovered session identity adoption", () => {
  beforeEach(() => {
    useSessionSelectionStore.getState().clearSelection();
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionIntentStore.getState().clear();
    useWorkspaceUiStore.setState({
      activeShellTabKeyByWorkspace: {},
      shellActivationEpochByWorkspace: {},
      pendingChatActivationByWorkspace: {},
      shellTabOrderByWorkspace: {},
      visibleChatSessionIdsByWorkspace: {},
      manualChatGroupsByWorkspace: {},
    });
  });

  it("writes completion to the captured shell owner after selection changes", () => {
    const clientSessionId = "client-session:codex:recovered";
    const runtimeSessionId = "21234567-89ab-4def-8123-456789abcdef";
    const selection = useSessionSelectionStore.getState();
    selection.activateWorkspace({
      logicalWorkspaceId: "logical-workspace-a",
      workspaceId: "runtime-workspace-a",
      initialActiveSessionId: clientSessionId,
    });
    putSessionRecord(createEmptySessionRecord(clientSessionId, "codex", {
      workspaceId: "runtime-workspace-a",
      materializedSessionId: null,
    }));
    const initialWrite = writeChatShellIntentForSession({
      workspaceId: "runtime-workspace-a",
      sessionId: clientSessionId,
    });
    expect(initialWrite?.shellWorkspaceId).toBe("logical-workspace-a");
    const workspaceUi = useWorkspaceUiStore.getState();
    workspaceUi.setShellTabOrderForWorkspace("logical-workspace-a", [
      chatWorkspaceShellTabKey(clientSessionId),
    ]);
    workspaceUi.setVisibleChatSessionIdsForWorkspace(
      "logical-workspace-a",
      [clientSessionId],
    );
    materializeSessionRecord(
      clientSessionId,
      runtimeSessionId,
      createEmptySessionRecord(clientSessionId, "codex", {
        workspaceId: "runtime-workspace-a",
        materializedSessionId: runtimeSessionId,
      }),
    );

    selection.activateWorkspace({
      logicalWorkspaceId: "logical-workspace-b",
      workspaceId: "runtime-workspace-b",
      initialActiveSessionId: "other-session",
    });
    writeChatShellIntentForSession({
      workspaceId: "runtime-workspace-b",
      sessionId: "other-session",
    });
    let completionOwner: string | null | undefined;

    const adoptedSessionId = adoptRecoveredSessionIdentity({
      clientSessionId,
      materializedWorkspaceId: "runtime-workspace-a",
      ownedShellWorkspaceId: initialWrite?.shellWorkspaceId ?? null,
      resolvedSessionId: clientSessionId,
      writeOwnedShellIntent: (sessionId, shellWorkspaceId) => {
        completionOwner = shellWorkspaceId;
        writeChatShellIntentForSession({
          workspaceId: "runtime-workspace-a",
          shellWorkspaceId,
          sessionId,
        });
      },
    });

    const promotedUi = useWorkspaceUiStore.getState();
    expect(adoptedSessionId).toBe(runtimeSessionId);
    expect(completionOwner).toBe("logical-workspace-a");
    expect(promotedUi.activeShellTabKeyByWorkspace["logical-workspace-a"])
      .toBe(chatWorkspaceShellTabKey(runtimeSessionId));
    expect(promotedUi.activeShellTabKeyByWorkspace["logical-workspace-b"])
      .toBe(chatWorkspaceShellTabKey("other-session"));
    expect(promotedUi.shellTabOrderByWorkspace["logical-workspace-a"])
      .toEqual([chatWorkspaceShellTabKey(runtimeSessionId)]);
    expect(promotedUi.visibleChatSessionIdsByWorkspace["logical-workspace-a"])
      .toEqual([runtimeSessionId]);
    expect(useSessionSelectionStore.getState().selectedWorkspaceId)
      .toBe("runtime-workspace-b");
    expect(useSessionSelectionStore.getState().activeSessionId).toBe("other-session");
    expect(getSessionRecord(clientSessionId)).toBeNull();
  });
});
