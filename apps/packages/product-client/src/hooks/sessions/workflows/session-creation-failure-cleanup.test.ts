import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupSessionCreationFailure } from "#product/hooks/sessions/workflows/session-creation-failure-cleanup";
import { workspaceDirectoryMissingBlockError } from "#product/lib/domain/sessions/creation/create-session-error";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useChatInputStore } from "#product/stores/chat/chat-input-store";
import { useChatPromptRecoveryStore } from "#product/stores/chat/chat-prompt-recovery-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

beforeEach(() => {
  useChatInputStore.setState({ draftByWorkspaceId: {} });
  useChatPromptRecoveryStore.getState().clear();
  useSessionDirectoryStore.getState().clearEntries();
  useSessionIntentStore.getState().clear();
  useSessionSelectionStore.getState().clearSelection();
  useSessionTranscriptStore.getState().clearEntries();
});

describe("replacement session creation failure", () => {
  it("restores the exact old shell and recovers user work acquired during materialization", () => {
    const oldRecord = createEmptySessionRecord("old-session", "codex", {
      workspaceId: "workspace-1",
      materializedSessionId: "runtime-old",
      modelId: "gpt-5",
    });
    putSessionRecord(createEmptySessionRecord("pending-claude", "claude", {
      workspaceId: "workspace-1",
      materializedSessionId: null,
      modelId: "sonnet",
    }));
    useSessionIntentStore.getState().enqueuePrompt({
      clientPromptId: "prompt-1",
      clientSessionId: "pending-claude",
      workspaceId: "workspace-1",
      text: "Use the attached context",
      blocks: [
        { type: "text", text: "Use the attached context" },
        { type: "plan_reference", planId: "plan-1", snapshotHash: "hash-1" },
      ],
      attachmentSnapshots: [{
        id: "attachment-1",
        name: "context.txt",
        mimeType: "text/plain",
        size: 12,
        kind: "text_resource",
        source: "upload",
        file: { name: "context.txt" },
      }],
    });
    useSessionIntentStore.getState().enqueuePrompt({
      clientPromptId: "prompt-2",
      clientSessionId: "pending-claude",
      workspaceId: "workspace-1",
      text: "Then run the tests",
      blocks: [{ type: "text", text: "Then run the tests" }],
    });
    useChatInputStore.getState().setDraftText("logical-workspace-1", "newer draft");
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: "logical-workspace-1",
      workspaceId: "workspace-1",
    });
    useSessionSelectionStore.getState().setActiveSessionId("pending-claude");
    const activateSession = vi.fn((sessionId: string) => {
      useSessionSelectionStore.getState().setActiveSessionId(sessionId);
    });
    const rollbackPreferences = vi.fn();
    const rollbackReplacement = vi.fn(() => putSessionRecord(oldRecord));

    cleanupSessionCreationFailure({
      agentKind: "claude",
      currentOwnedSessionId: "pending-claude",
      error: new Error("materialization failed"),
      hadExistingProjectedRecord: false,
      hasPrompt: false,
      modeId: "agent",
      modelId: "sonnet",
      pendingSessionId: "pending-claude",
      preserveProjectedSessionOnCreateFailure: false,
      previousActiveSessionId: "old-session",
      recoveryWorkspaceUiKey: "logical-workspace-1",
      replacementShellPreferences: { rollback: rollbackPreferences },
      replacementTransaction: {
        replacedSessionId: "old-session",
        commit: vi.fn(),
        rollback: rollbackReplacement,
      },
      rollbackOwnedShellIntent: () => true,
      workspaceId: "workspace-1",
    }, { activateSession, captureException: vi.fn() });

    expect(getSessionRecord("old-session")).not.toBeNull();
    expect(getSessionRecord("pending-claude")).toBeNull();
    expect(useSessionSelectionStore.getState().activeSessionId).toBe("old-session");
    expect(rollbackPreferences).toHaveBeenCalledOnce();
    expect(rollbackReplacement).toHaveBeenCalledOnce();
    expect(useChatInputStore.getState().draftByWorkspaceId["logical-workspace-1"])
      .toEqual({ nodes: [{ type: "text", text: "newer draft" }] });
    expect(useSessionIntentStore.getState().entriesById["prompt-1"]).toBeUndefined();
    const recovered = useChatPromptRecoveryStore.getState()
      .recoveriesByWorkspaceUiKey["logical-workspace-1"];
    expect(recovered).toEqual([
      expect.objectContaining({
        agentKind: "claude",
        modeId: "agent",
        modelId: "sonnet",
        prompt: expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({ type: "plan_reference", planId: "plan-1" }),
          ]),
          attachmentSnapshots: [expect.objectContaining({ id: "attachment-1" })],
        }),
      }),
      expect.objectContaining({
        prompt: expect.objectContaining({ text: "Then run the tests" }),
      }),
    ]);
  });

  it("removes a replacement that remained empty before restoring the old shell", () => {
    const oldRecord = createEmptySessionRecord("old-session", "codex", {
      workspaceId: "workspace-1",
      materializedSessionId: "runtime-old",
    });
    putSessionRecord(createEmptySessionRecord("pending-claude", "claude", {
      workspaceId: "workspace-1",
      materializedSessionId: null,
    }));
    useSessionSelectionStore.getState().setActiveSessionId("pending-claude");
    const activateSession = vi.fn((sessionId: string) => {
      useSessionSelectionStore.getState().setActiveSessionId(sessionId);
    });

    cleanupSessionCreationFailure({
      agentKind: "claude",
      currentOwnedSessionId: "pending-claude",
      error: new Error("materialization failed"),
      hadExistingProjectedRecord: false,
      hasPrompt: false,
      modeId: null,
      modelId: "sonnet",
      pendingSessionId: "pending-claude",
      preserveProjectedSessionOnCreateFailure: false,
      previousActiveSessionId: "old-session",
      recoveryWorkspaceUiKey: "workspace-1",
      replacementShellPreferences: null,
      replacementTransaction: {
        replacedSessionId: "old-session",
        commit: vi.fn(),
        rollback: () => putSessionRecord(oldRecord),
      },
      rollbackOwnedShellIntent: () => true,
      workspaceId: "workspace-1",
    }, { activateSession, captureException: vi.fn() });

    expect(getSessionRecord("pending-claude")).toBeNull();
    expect(getSessionRecord("old-session")).not.toBeNull();
    expect(useSessionSelectionStore.getState().activeSessionId).toBe("old-session");
  });
});

describe("prompt-bearing session creation failure", () => {
  function enqueuePendingPrompt() {
    putSessionRecord(createEmptySessionRecord("pending-claude", "claude", {
      workspaceId: "workspace-1",
      materializedSessionId: null,
      modelId: "sonnet",
    }));
    useSessionIntentStore.getState().enqueuePrompt({
      clientPromptId: "prompt-1",
      clientSessionId: "pending-claude",
      workspaceId: "workspace-1",
      text: "fix the sidebar race",
      blocks: [{ type: "text", text: "fix the sidebar race" }],
    });
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: "logical-workspace-1",
      workspaceId: "workspace-1",
    });
    useSessionSelectionStore.getState().setActiveSessionId("pending-claude");
  }

  function cleanupWith(error: unknown) {
    cleanupSessionCreationFailure({
      agentKind: "claude",
      currentOwnedSessionId: "pending-claude",
      error,
      hadExistingProjectedRecord: false,
      hasPrompt: true,
      modeId: "agent",
      modelId: "sonnet",
      pendingSessionId: "pending-claude",
      preserveProjectedSessionOnCreateFailure: false,
      previousActiveSessionId: null,
      recoveryWorkspaceUiKey: "logical-workspace-1",
      replacementShellPreferences: null,
      replacementTransaction: null,
      rollbackOwnedShellIntent: () => true,
      workspaceId: "workspace-1",
    }, { activateSession: vi.fn(), captureException: vi.fn() });
  }

  it("keeps the projected shell for generic failures so the prompt can be retried in place", () => {
    enqueuePendingPrompt();

    cleanupWith(new Error("materialization failed"));

    expect(getSessionRecord("pending-claude")).not.toBeNull();
    expect(
      useChatPromptRecoveryStore.getState().recoveriesByWorkspaceUiKey["logical-workspace-1"],
    ).toBeUndefined();
  });

  it("discards the dead shell and moves the prompt to recovery when the checkout is missing", () => {
    enqueuePendingPrompt();

    cleanupWith(workspaceDirectoryMissingBlockError(
      "Worktree no longer exists. Agents can't run in this workspace.",
    ));

    expect(getSessionRecord("pending-claude")).toBeNull();
    const recovered = useChatPromptRecoveryStore.getState()
      .recoveriesByWorkspaceUiKey["logical-workspace-1"];
    expect(recovered).toEqual([
      expect.objectContaining({
        workspaceId: "workspace-1",
        prompt: expect.objectContaining({ text: "fix the sidebar race" }),
      }),
    ]);
  });
});

describe("projected empty-session materialization failure", () => {
  it("retains the selected shell when the caller owns inline recovery", () => {
    putSessionRecord(createEmptySessionRecord("client-session:claude:recovery", "claude", {
      workspaceId: "workspace-1",
      materializedSessionId: null,
      modelId: "sonnet",
    }));
    useSessionSelectionStore.getState().setActiveSessionId(
      "client-session:claude:recovery",
    );

    cleanupSessionCreationFailure({
      agentKind: "claude",
      currentOwnedSessionId: "client-session:claude:recovery",
      error: new Error("materialization failed"),
      hadExistingProjectedRecord: false,
      hasPrompt: false,
      modeId: null,
      modelId: "sonnet",
      pendingSessionId: "client-session:claude:recovery",
      preserveProjectedSessionOnCreateFailure: true,
      previousActiveSessionId: null,
      recoveryWorkspaceUiKey: "workspace-1",
      replacementShellPreferences: null,
      replacementTransaction: null,
      rollbackOwnedShellIntent: vi.fn(() => true),
      workspaceId: "workspace-1",
    }, { activateSession: vi.fn(), captureException: vi.fn() });

    expect(getSessionRecord("client-session:claude:recovery")).toMatchObject({
      materializedSessionId: null,
      status: "errored",
      workspaceId: "workspace-1",
    });
    expect(useSessionSelectionStore.getState().activeSessionId)
      .toBe("client-session:claude:recovery");
  });
});
