// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSession } from "#product/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { useSessionSelectionWorkflowActions } from "#product/hooks/sessions/workflows/use-session-selection-actions";
import { useWorkspaceActivationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-activation-workflow";
import {
  createEmptySessionRecord,
  getSessionRecords,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";

const workflowMocks = vi.hoisted(() => ({
  selectWorkspace: vi.fn(),
  activateChatTab: vi.fn(),
}));

vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({ selectWorkspace: workflowMocks.selectWorkspace }),
}));

vi.mock("#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation", () => ({
  useWorkspaceShellActivation: () => ({ activateChatTab: workflowMocks.activateChatTab }),
}));

vi.mock("#product/hooks/workspaces/derived/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    getWorkspaceRuntimeBlockReason: () => null,
  }),
}));

beforeEach(() => {
  workflowMocks.selectWorkspace.mockReset();
  workflowMocks.activateChatTab.mockReset();
  useSessionDirectoryStore.getState().clearEntries();
  useSessionTranscriptStore.getState().clearEntries();
  useSessionSelectionStore.getState().clearSelection();
  useWorkspaceUiStore.setState({
    lastViewedSessionByWorkspace: { "workspace-target": "client-session:cached" },
  });
  putSessionRecord(createEmptySessionRecord("client-session:cached", "codex", {
    workspaceId: "workspace-target",
    materializedSessionId: "cached-durable",
    title: "Previously viewed",
  }));
  workflowMocks.selectWorkspace.mockImplementation(async (workspaceId: string) => {
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: null,
      workspaceId,
      initialActiveSessionId: "client-session:cached",
    });
  });
});

afterEach(() => cleanup());

describe("useWorkspaceActivationWorkflow exact session opening", () => {
  it("materializes and activates an uncached durable target after another slot hot-reopens", async () => {
    const targetSessionId = "agent-session-new";
    const { result } = renderActivationWorkflow(targetSessionId);

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.openWorkspaceSession({
        workspaceId: "workspace-target",
        sessionId: targetSessionId,
      });
    });

    expect(outcome).toMatchObject({ result: "completed", sessionId: targetSessionId });
    expect(workflowMocks.selectWorkspace).toHaveBeenCalledWith("workspace-target", {
      force: true,
      forceCold: undefined,
      latencyFlowId: undefined,
    });
    expect(useSessionSelectionStore.getState().activeSessionId).toBe(targetSessionId);
    expect(Object.keys(getSessionRecords())).toEqual([
      "client-session:cached",
      targetSessionId,
    ]);
    expect(logicalTargetRecordCount(targetSessionId)).toBe(1);
  });

  it("activates an existing mapped client key without creating a durable duplicate", async () => {
    const durableSessionId = "agent-session-mapped";
    const clientSessionId = "client-session:mapped";
    putSessionRecord(createEmptySessionRecord(clientSessionId, "codex", {
      workspaceId: "workspace-target",
      materializedSessionId: durableSessionId,
      title: "Mapped target",
    }));
    const { result } = renderActivationWorkflow(durableSessionId);

    await act(async () => {
      await result.current.openWorkspaceSession({
        workspaceId: "workspace-target",
        sessionId: clientSessionId,
      });
    });

    expect(useSessionSelectionStore.getState().activeSessionId).toBe(clientSessionId);
    expect(getSessionRecords()[durableSessionId]).toBeUndefined();
    expect(logicalTargetRecordCount(durableSessionId)).toBe(1);
  });
});

function renderActivationWorkflow(materializedSessionId: string) {
  const ensureWorkspaceSessions = vi.fn(async (): Promise<WorkspaceSession[]> => [{
    id: materializedSessionId,
    workspaceId: "workspace-target",
    agentKind: "codex",
    modelId: "gpt-5.6-sol",
    status: "idle",
    lastPromptAt: null,
  } as WorkspaceSession]);
  const rendered = renderHook(() => {
    const { selectSession } = useSessionSelectionWorkflowActions({
      activateSession: (sessionId) => {
        useSessionSelectionStore.getState().setActiveSessionId(sessionId);
      },
      ensureWorkspaceSessions,
    });
    const { openWorkspaceSession } = useWorkspaceActivationWorkflow();
    return { openWorkspaceSession, selectSession };
  });
  workflowMocks.activateChatTab.mockImplementation(async ({
    sessionId,
    selection,
  }: {
    sessionId: string;
    selection?: Record<string, unknown>;
  }) => {
    await rendered.result.current.selectSession(sessionId, selection);
    return {
      result: "completed",
      sessionId,
      guard: null,
      activeSessionVersion: useSessionSelectionStore.getState().activeSessionVersion,
    };
  });
  return rendered;
}

function logicalTargetRecordCount(materializedSessionId: string): number {
  return Object.values(getSessionRecords()).filter((record) =>
    record.sessionId === materializedSessionId
    || record.materializedSessionId === materializedSessionId
  ).length;
}
