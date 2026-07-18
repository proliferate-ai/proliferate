// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionPromptActions } from "#product/hooks/sessions/workflows/use-session-prompt-actions";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

const mocks = vi.hoisted(() => ({
  getWorkspaceRuntimeBlockReason: vi.fn(),
  promptSession: vi.fn(),
}));

vi.mock("#product/hooks/sessions/workflows/use-session-prompt-workflow", () => ({
  useSessionPromptWorkflow: () => ({ promptSession: mocks.promptSession }),
}));

vi.mock("#product/hooks/workspaces/derived/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    getWorkspaceRuntimeBlockReason: mocks.getWorkspaceRuntimeBlockReason,
  }),
}));

describe("useSessionPromptActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspaceRuntimeBlockReason.mockReturnValue(null);
    mocks.promptSession.mockResolvedValue(undefined);
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionSelectionStore.getState().clearSelection();
  });

  afterEach(() => {
    cleanup();
  });

  it("dispatches an intentional prompt for an idle prompt-ready session with an active goal", async () => {
    const sessionId = "client-session-active-goal";
    const workspaceId = "workspace-active-goal";
    putSessionRecord({
      ...createEmptySessionRecord(sessionId, "codex", {
        materializedSessionId: "runtime-session-active-goal",
        workspaceId,
        activeGoal: {
          createdAt: "2026-07-17T12:00:00.000Z",
          native: true,
          objective: "Finish the requested repair",
          revision: 1,
          status: "active",
          tokenBudget: 50_000,
          updatedAt: "2026-07-17T12:00:00.000Z",
        },
      }),
      status: "idle",
      transcriptHydrated: true,
    });
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: workspaceId,
      workspaceId,
      initialActiveSessionId: sessionId,
    });

    expect(getSessionRecord(sessionId)).toMatchObject({
      materializedSessionId: "runtime-session-active-goal",
      status: "idle",
      transcriptHydrated: true,
      activeGoal: { status: "active" },
    });

    const { result } = renderHook(() => useSessionPromptActions());
    await act(async () => {
      await result.current.promptActiveSession("Continue deliberately");
    });

    expect(mocks.getWorkspaceRuntimeBlockReason).toHaveBeenCalledWith(workspaceId);
    expect(mocks.promptSession).toHaveBeenCalledOnce();
    expect(mocks.promptSession).toHaveBeenCalledWith({
      sessionId,
      text: "Continue deliberately",
      blocks: undefined,
      attachmentSnapshots: undefined,
      optimisticContentParts: undefined,
      workspaceId,
      latencyFlowId: undefined,
      measurementOperationId: undefined,
      promptId: undefined,
    });
  });
});
