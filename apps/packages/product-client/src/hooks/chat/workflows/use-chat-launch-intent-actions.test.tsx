// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatLaunchIntent } from "#product/lib/domain/chat/launch/launch-intent";
import type { HomeNextLaunchOutcome } from "#product/lib/domain/home/home-next-launch";
import {
  useChatLaunchIntentActions,
} from "#product/hooks/chat/workflows/use-chat-launch-intent-actions";
import { useChatLaunchIntentStore } from "#product/stores/chat/chat-launch-intent-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  openWorkspaceSession: vi.fn(),
  selectWorkspace: vi.fn(),
}));

vi.mock("#product/hooks/home/workflows/use-home-next-launch", () => ({
  useHomeNextLaunch: () => ({ isLaunching: false, launch: mocks.launch }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-activation-workflow", () => ({
  useWorkspaceActivationWorkflow: () => ({
    openWorkspaceSession: mocks.openWorkspaceSession,
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({ selectWorkspace: mocks.selectWorkspace }),
}));

function failedIntent(id: string, createdAt: number): ChatLaunchIntent {
  return {
    id,
    promptId: `prompt-${id}`,
    text: "start the work",
    contentParts: [{ type: "text", text: "start the work" }],
    targetKind: "worktree",
    retryInput: {
      text: "start the work",
      modelSelection: { kind: "codex", modelId: "gpt-5.4" },
      modeId: null,
      target: {
        kind: "worktree",
        repoRootId: "repo-root-1",
        sourceWorkspaceId: null,
        baseBranch: "main",
        defaultBranch: "main",
      },
    },
    materializedWorkspaceId: null,
    materializedSessionId: null,
    attemptId: null,
    targetWorkspaceId: null,
    createdAt,
    sendAttemptedAt: null,
    failure: { message: "Failed to create worktree.", retryMode: "safe" },
  };
}

describe("useChatLaunchIntentActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionSelectionStore.getState().clearSelection();
    useChatLaunchIntentStore.setState({ intentsById: {}, intentOrder: [] });
  });

  afterEach(cleanup);

  // PR #1870 review finding 4: `begin` no longer evicts the previous intent, so
  // retrying left the failed one keyed to the same (unscoped, Home) shell as
  // its replacement. Once the replacement succeeded and cleared itself, the
  // survivor re-mounted "Couldn't start work" over a Home the user had just
  // launched successfully from.
  it("clears the intent it retried once the replacement has run", async () => {
    useChatLaunchIntentStore.getState().begin(failedIntent("failed-launch", 100));
    mocks.launch.mockImplementation(async (): Promise<HomeNextLaunchOutcome> => {
      // A real launch mints its own intent and clears it on success.
      useChatLaunchIntentStore.getState().begin(failedIntent("replacement-launch", 200));
      useChatLaunchIntentStore.getState().clear("replacement-launch");
      return "launched";
    });

    const { result } = renderHook(() => useChatLaunchIntentActions());

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(useChatLaunchIntentStore.getState().intentOrder).toEqual([]);
    });
    expect(mocks.launch).toHaveBeenCalledTimes(1);
  });

  it("keeps the failed intent when the retry never started", async () => {
    useChatLaunchIntentStore.getState().begin(failedIntent("failed-launch", 100));
    // The cap (or an unavailable target) refuses before any replacement exists,
    // so the failed pane is still the only place the prompt lives.
    mocks.launch.mockResolvedValue("refused" satisfies HomeNextLaunchOutcome);

    const { result } = renderHook(() => useChatLaunchIntentActions());

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(mocks.launch).toHaveBeenCalledTimes(1);
    });
    expect(useChatLaunchIntentStore.getState().intentOrder).toEqual(["failed-launch"]);
  });

  it("does nothing for a failure that is not safe to retry", () => {
    useChatLaunchIntentStore.getState().begin({
      ...failedIntent("manual-launch", 100),
      failure: { message: "Workspace exists.", retryMode: "manual_after_workspace" },
    });

    const { result } = renderHook(() => useChatLaunchIntentActions());

    act(() => {
      result.current.retry();
    });

    expect(mocks.launch).not.toHaveBeenCalled();
    expect(useChatLaunchIntentStore.getState().intentOrder).toEqual(["manual-launch"]);
  });
});
