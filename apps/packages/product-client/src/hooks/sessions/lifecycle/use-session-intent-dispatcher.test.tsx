// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionIntentDispatcher } from "#product/hooks/sessions/lifecycle/use-session-intent-dispatcher";
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

const mocks = vi.hoisted(() => ({
  dispatchConfigIntent: vi.fn(),
  dispatchPromptIntent: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    cloud: { client: null },
    desktop: null,
  }),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useDeletePendingPromptMutation: () => ({}),
  useEditPendingPromptMutation: () => ({}),
  usePromptSessionMutation: () => ({}),
  useResolveSessionInteractionMutation: () => ({}),
  useSetSessionConfigOptionMutation: () => ({}),
}));

vi.mock("#product/hooks/sessions/lifecycle/use-session-history-hydration", () => ({
  useSessionHistoryHydration: () => ({ rehydrateSessionSlotFromHistory: vi.fn() }),
}));

vi.mock("#product/hooks/sessions/workflows/use-session-summary-actions", () => ({
  useSessionSummaryActions: () => ({ applySessionSummary: vi.fn() }),
}));

vi.mock("#product/hooks/sessions/workflows/use-session-title-actions", () => ({
  useSessionTitleActions: () => ({ maybeGenerateSessionTitle: vi.fn() }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-name-actions", () => ({
  useWorkspaceNameActions: () => ({ maybeGenerateWorkspaceName: vi.fn() }),
}));

vi.mock("#product/hooks/workspaces/derived/use-workspace-surface-lookup", () => ({
  useWorkspaceSurfaceLookup: () => ({ getWorkspaceSurface: vi.fn() }),
}));

vi.mock("#product/hooks/access/anyharness/sessions/use-workspace-session-cache", () => ({
  useWorkspaceSessionCache: () => ({ upsertWorkspaceSessionRecord: vi.fn() }),
}));

vi.mock("#product/hooks/sessions/lifecycle/session-intent-config-dispatch", () => ({
  dispatchConfigIntent: mocks.dispatchConfigIntent,
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: typeof mocks.showToast }) => unknown) =>
    selector({ show: mocks.showToast }),
}));

vi.mock("#product/hooks/sessions/lifecycle/session-intent-interaction-dispatch", () => ({
  dispatchDeletePendingPromptIntent: vi.fn(),
  dispatchEditPendingPromptIntent: vi.fn(),
  dispatchInteractionIntent: vi.fn(),
}));

vi.mock("#product/hooks/sessions/lifecycle/session-intent-prompt-dispatch", () => ({
  dispatchPromptIntent: mocks.dispatchPromptIntent,
}));

describe("useSessionIntentDispatcher", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useSessionIntentStore.getState().clear();
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    putSessionRecord(createEmptySessionRecord("session-1", "codex", {
      workspaceId: "workspace-1",
      materializedSessionId: "runtime-session-1",
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it("dispatches the next same-session prompt after canceling one in preparation", async () => {
    const firstDispatch = deferred<void>();
    mocks.dispatchPromptIntent
      .mockImplementationOnce(() => firstDispatch.promise)
      .mockImplementationOnce((intent) => {
        useSessionIntentStore.getState().patchIntent(intent.intentId, {
          status: "accepted",
          deliveryState: "accepted_running",
        });
        return Promise.resolve();
      });

    renderHook(() => useSessionIntentDispatcher());

    act(() => {
      enqueuePrompt("prompt-1", "first");
    });
    await waitFor(() => {
      expect(mocks.dispatchPromptIntent).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useSessionIntentStore.getState().patchIntent("prompt-1", {
        status: "preparing",
        deliveryState: "preparing",
      });
      enqueuePrompt("prompt-2", "second");
    });
    expect(mocks.dispatchPromptIntent).toHaveBeenCalledTimes(1);

    // cancelBeforeDispatch removes a preparing prompt. This store update runs
    // while the session is serialized behind prompt-1, so prompt-2 must be
    // reconsidered when prompt-1's preparation finally returns.
    act(() => {
      useSessionIntentStore.getState().removeIntent("prompt-1");
    });
    expect(mocks.dispatchPromptIntent).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstDispatch.resolve();
      await firstDispatch.promise;
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mocks.dispatchPromptIntent).toHaveBeenCalledTimes(2);
    });
    expect(mocks.dispatchPromptIntent.mock.calls[1]?.[0]).toMatchObject({
      clientPromptId: "prompt-2",
      deliveryState: "waiting_for_session",
    });
  });

  it("surfaces an asynchronous config rejection through existing error language", async () => {
    mocks.dispatchConfigIntent.mockImplementation(async (intent, deps) => {
      deps.onFailure?.("request timed out");
      useSessionIntentStore.getState().patchIntent(intent.intentId, {
        status: "failed",
        errorMessage: "request timed out",
      });
    });
    renderHook(() => useSessionIntentDispatcher());

    act(() => {
      useSessionIntentStore.getState().enqueueConfig({
        intentId: "config-plan",
        clientSessionId: "session-1",
        materializedSessionId: "runtime-session-1",
        workspaceId: "workspace-1",
        configId: "collaboration_mode",
        value: "plan",
      });
    });

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith(
        "Failed to update session config: request timed out",
      );
    });
  });
});

function enqueuePrompt(clientPromptId: string, text: string): void {
  useSessionIntentStore.getState().enqueuePrompt({
    clientPromptId,
    clientSessionId: "session-1",
    materializedSessionId: "runtime-session-1",
    workspaceId: "workspace-1",
    text,
    blocks: [{ type: "text", text }],
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
