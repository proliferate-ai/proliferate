// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHotSessionIngest } from "#product/hooks/sessions/lifecycle/use-hot-session-ingest";
import { reconcileHotSessions } from "#product/lib/workflows/sessions/hot-session-ingest-manager";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

const runtimeActions = vi.hoisted(() => ({
  closeSessionSlotStream: vi.fn(),
  ensureSessionStreamConnected: vi.fn(),
}));

vi.mock("#product/hooks/sessions/workflows/use-session-runtime-actions", () => ({
  useSessionRuntimeActions: () => runtimeActions,
}));

vi.mock("#product/lib/workflows/sessions/hot-session-ingest-manager", () => ({
  reconcileHotSessions: vi.fn(),
}));

describe("useHotSessionIngest", () => {
  beforeEach(() => {
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionSelectionStore.getState().clearSelection();
    useWorkspaceUiStore.setState({ visibleChatSessionIdsByWorkspace: {} });
    vi.mocked(reconcileHotSessions).mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps streaming background work hot across workspace and workflow navigation", async () => {
    putSession({
      sessionId: "selected-session",
      workspaceId: "selected-workspace",
      streaming: false,
    });
    putSession({
      sessionId: "background-session",
      workspaceId: "background-workspace",
      streaming: true,
    });
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: "selected-logical-workspace",
      workspaceId: "selected-workspace",
      initialActiveSessionId: "selected-session",
    });

    renderHook(() => useHotSessionIngest());

    await waitFor(() => {
      expect(latestTargetReasons()).toEqual([
        ["selected-session", "selected"],
        ["background-session", "running"],
      ]);
    });

    act(() => {
      useSessionSelectionStore.getState().deselectWorkspacePreservingSessions();
    });

    await waitFor(() => {
      expect(latestTargetReasons()).toEqual([
        ["background-session", "running"],
      ]);
    });

    act(() => {
      useSessionDirectoryStore.getState().patchEntry("background-session", {
        streamConnectionState: "disconnected",
        activity: { isStreaming: false },
      });
    });

    await waitFor(() => {
      expect(latestTargetReasons()).toEqual([]);
    });
  });
});

function putSession({
  sessionId,
  workspaceId,
  streaming,
}: {
  sessionId: string;
  workspaceId: string;
  streaming: boolean;
}): void {
  useSessionDirectoryStore.getState().upsertEntry({
    sessionId,
    workspaceId,
    agentKind: "codex",
    status: "idle",
    streamConnectionState: streaming ? "open" : "disconnected",
    activity: { isStreaming: streaming },
  });
  useSessionTranscriptStore.getState().ensureEntry(sessionId);
}

function latestTargetReasons(): string[][] {
  const calls = vi.mocked(reconcileHotSessions).mock.calls;
  return (calls.at(-1)?.[0] ?? []).map((target) => [
    target.clientSessionId,
    target.reason,
  ]);
}
