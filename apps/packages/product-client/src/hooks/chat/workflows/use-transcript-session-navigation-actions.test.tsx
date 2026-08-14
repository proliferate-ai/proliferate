// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { TranscriptState } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTranscriptSessionNavigationActions } from "#product/hooks/chat/workflows/use-transcript-session-navigation-actions";

const mocks = vi.hoisted(() => ({
  activateChatTab: vi.fn(),
  openWorkspaceSession: vi.fn(),
  selectedWorkspaceId: "workspace-current" as string | null,
  sessionRecords: {} as Record<string, { workspaceId: string | null }>,
  workspaceCollections: {
    allWorkspaces: [] as Array<Record<string, unknown>>,
    cloudWorkspaces: [] as Array<Record<string, unknown>>,
  },
  coworkManagedWorkspaces: [] as Array<{
    workspaceId: string;
    sessions: Array<{ codingSessionId: string }>;
  }>,
  useCoworkManagedWorkspaces: vi.fn(),
}));

vi.mock("#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation", () => ({
  useWorkspaceShellActivation: () => ({ activateChatTab: mocks.activateChatTab }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-activation-workflow", () => ({
  useWorkspaceActivationWorkflow: () => ({
    openWorkspaceSession: mocks.openWorkspaceSession,
  }),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({ data: mocks.workspaceCollections }),
}));

vi.mock("#product/hooks/access/anyharness/cowork/use-cowork-managed-workspaces", () => ({
  useCoworkManagedWorkspaces: (sessionId: string | null, enabled: boolean) => {
    mocks.useCoworkManagedWorkspaces(sessionId, enabled);
    return { workspaces: mocks.coworkManagedWorkspaces, isLoading: false };
  },
}));

vi.mock("#product/stores/sessions/session-records", () => ({
  getSessionRecord: (sessionId: string) => mocks.sessionRecords[sessionId] ?? null,
  getSessionRecords: () => mocks.sessionRecords,
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: {
    getState: () => ({ selectedWorkspaceId: mocks.selectedWorkspaceId }),
  },
}));

beforeEach(() => {
  mocks.activateChatTab.mockReset();
  mocks.openWorkspaceSession.mockReset();
  mocks.useCoworkManagedWorkspaces.mockReset();
  mocks.selectedWorkspaceId = "workspace-current";
  mocks.sessionRecords = {
    "source-session": { workspaceId: "workspace-current" },
  };
  mocks.workspaceCollections = {
    allWorkspaces: [],
    cloudWorkspaces: [],
  };
  mocks.coworkManagedWorkspaces = [];
});

afterEach(() => cleanup());

describe("useTranscriptSessionNavigationActions", () => {
  it("activates same-workspace ordinary and root sessions without workspace navigation", () => {
    mocks.sessionRecords["ordinary-session"] = { workspaceId: "workspace-current" };
    mocks.workspaceCollections.allWorkspaces = [{
      id: "workspace-current",
      creatorContext: {
        kind: "agent",
        sourceSessionId: "root-session",
        sourceSessionWorkspaceId: "workspace-current",
      },
    }];
    const { result } = renderNavigationActions();

    expect(result.current.canOpenTranscriptSession("ordinary-session")).toBe(true);
    expect(result.current.canOpenTranscriptSession("root-session", "agent-parent")).toBe(true);
    act(() => {
      result.current.openTranscriptSession("ordinary-session");
      result.current.openTranscriptSession("root-session", "agent-parent");
    });

    expect(mocks.activateChatTab).toHaveBeenNthCalledWith(1, {
      workspaceId: "workspace-current",
      sessionId: "ordinary-session",
      source: "session-transcript-pane",
    });
    expect(mocks.activateChatTab).toHaveBeenNthCalledWith(2, {
      workspaceId: "workspace-current",
      sessionId: "root-session",
      source: "session-transcript-pane",
    });
    expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();
  });

  it("uses workspace navigation for an ordinary session owned elsewhere", () => {
    mocks.sessionRecords["other-session"] = { workspaceId: "workspace-other" };
    const { result } = renderNavigationActions();

    act(() => result.current.openTranscriptSession("other-session"));

    expect(mocks.openWorkspaceSession).toHaveBeenCalledWith({
      workspaceId: "workspace-other",
      sessionId: "other-session",
    });
    expect(mocks.activateChatTab).not.toHaveBeenCalled();
  });

  it("opens a cowork child in the owning managed workspace", () => {
    mocks.coworkManagedWorkspaces = [{
      workspaceId: "workspace-cowork",
      sessions: [{ codingSessionId: "cowork-child" }],
    }];
    const { result } = renderNavigationActions(coworkTranscript());

    expect(mocks.useCoworkManagedWorkspaces).toHaveBeenCalledWith("source-session", true);
    expect(result.current.canOpenTranscriptSession(
      "cowork-child",
      "cowork-coding-child",
    )).toBe(true);
    act(() => result.current.openTranscriptSession(
      "cowork-child",
      "cowork-coding-child",
    ));

    expect(mocks.openWorkspaceSession).toHaveBeenCalledWith({
      workspaceId: "workspace-cowork",
      sessionId: "cowork-child",
    });
    expect(mocks.activateChatTab).not.toHaveBeenCalled();
  });

  it("keeps an unresolved cowork child disabled and navigation-free", () => {
    const { result } = renderNavigationActions(coworkTranscript());

    expect(result.current.canOpenTranscriptSession(
      "missing-cowork-child",
      "cowork-coding-child",
    )).toBe(false);
    act(() => result.current.openTranscriptSession(
      "missing-cowork-child",
      "cowork-coding-child",
    ));

    expect(mocks.activateChatTab).not.toHaveBeenCalled();
    expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();
  });
});

function renderNavigationActions(transcript: TranscriptState | null = null) {
  return renderHook(() => useTranscriptSessionNavigationActions({
    sourceSessionId: "source-session",
    fallbackWorkspaceId: "workspace-current",
    transcript,
  }));
}

function coworkTranscript(): TranscriptState {
  return {
    linkCompletionsByCompletionId: {
      "completion-1": { relation: "cowork_coding_session" },
    },
  } as unknown as TranscriptState;
}
