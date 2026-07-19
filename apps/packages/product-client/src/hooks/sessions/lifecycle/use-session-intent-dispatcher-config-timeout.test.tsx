// @vitest-environment jsdom

import type {
  NormalizedSessionControl,
  Session,
  SessionLiveConfigSnapshot,
  SetSessionConfigOptionResponse,
} from "@anyharness/sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONFIG_INTENT_DISPATCH_TIMEOUT_MS,
} from "#product/hooks/sessions/lifecycle/session-intent-config-dispatch";
import { useSessionIntentDispatcher } from "#product/hooks/sessions/lifecycle/use-session-intent-dispatcher";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

const mocks = vi.hoisted(() => ({
  getSessionClientAndWorkspace: vi.fn(),
  mutateAsync: vi.fn(),
  persistDefaultSessionModePreference: vi.fn(),
  showToast: vi.fn(),
  upsertWorkspaceSessionRecord: vi.fn(),
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
  useSetSessionConfigOptionMutation: () => ({ mutateAsync: mocks.mutateAsync }),
}));

vi.mock("#product/lib/access/anyharness/session-runtime", () => ({
  getSessionClientAndWorkspace: mocks.getSessionClientAndWorkspace,
}));

vi.mock("#product/hooks/sessions/workflows/session-mode-preferences", () => ({
  persistDefaultSessionModePreference: mocks.persistDefaultSessionModePreference,
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
  useWorkspaceSessionCache: () => ({
    upsertWorkspaceSessionRecord: mocks.upsertWorkspaceSessionRecord,
  }),
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
  dispatchPromptIntent: vi.fn(),
}));

describe("useSessionIntentDispatcher config timeout", () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.mutateAsync.mockReset();
    useSessionIntentStore.getState().clear();
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    mocks.getSessionClientAndWorkspace.mockResolvedValue({
      workspaceId: "workspace-1",
      materializedSessionId: "runtime-session-1",
    });
    putSessionRecord(createEmptySessionRecord("session-1", "claude", {
      workspaceId: "workspace-1",
      materializedSessionId: "runtime-session-1",
      liveConfig: liveConfig("default", 1),
      modeId: "default",
    }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("releases the session after timeout and ignores the late stale response", async () => {
    const firstRequest = deferred<SetSessionConfigOptionResponse>();
    let firstSignal: AbortSignal | undefined;
    mocks.mutateAsync
      .mockImplementationOnce((input) => {
        firstSignal = input.requestOptions?.signal;
        return firstRequest.promise;
      })
      .mockResolvedValueOnce(configResponse("bypass", 3));

    renderHook(() => useSessionIntentDispatcher());

    act(() => {
      enqueueMode("config-plan", "plan");
    });
    await vi.waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    });

    act(() => {
      enqueueMode("config-bypass", "bypass");
    });
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFIG_INTENT_DISPATCH_TIMEOUT_MS);
    });
    await vi.waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(useSessionIntentStore.getState().entriesById["config-bypass"]).toMatchObject({
        status: "accepted",
        applyState: "applied",
      });
    });

    expect(useSessionIntentStore.getState().entriesById["config-plan"]).toMatchObject({
      status: "failed",
      errorMessage: "request timed out",
    });
    expect(firstSignal?.aborted).toBe(true);
    expect(mocks.showToast).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).toHaveBeenCalledWith(
      "Failed to update session config: request timed out",
    );
    expect(getSessionRecord("session-1")?.modeId).toBe("bypass");
    expect(mocks.persistDefaultSessionModePreference).toHaveBeenCalledTimes(1);
    expect(mocks.upsertWorkspaceSessionRecord).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstRequest.resolve(configResponse("plan", 2));
      await firstRequest.promise;
      await Promise.resolve();
    });

    expect(getSessionRecord("session-1")?.modeId).toBe("bypass");
    expect(useSessionIntentStore.getState().entriesById["config-plan"]).toMatchObject({
      status: "failed",
    });
    expect(mocks.showToast).toHaveBeenCalledTimes(1);
    expect(mocks.persistDefaultSessionModePreference).toHaveBeenCalledTimes(1);
    expect(mocks.upsertWorkspaceSessionRecord).toHaveBeenCalledTimes(1);
  });
});

function enqueueMode(intentId: string, value: string): void {
  useSessionIntentStore.getState().enqueueConfig({
    intentId,
    clientSessionId: "session-1",
    materializedSessionId: "runtime-session-1",
    workspaceId: "workspace-1",
    configId: "mode",
    value,
  });
}

function configResponse(modeId: string, sourceSeq: number): SetSessionConfigOptionResponse {
  const snapshot = liveConfig(modeId, sourceSeq);
  return {
    applyState: "applied",
    liveConfig: snapshot,
    session: session(modeId, snapshot),
  };
}

function session(modeId: string, snapshot: SessionLiveConfigSnapshot): Session {
  return {
    id: "runtime-session-1",
    workspaceId: "workspace-1",
    agentKind: "claude",
    modelId: "claude-sonnet-4-6",
    modeId,
    status: "idle",
    title: null,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    liveConfig: snapshot,
  } as Session;
}

function liveConfig(modeId: string, sourceSeq: number): SessionLiveConfigSnapshot {
  return {
    updatedAt: `2026-07-18T00:00:0${sourceSeq}.000Z`,
    sourceSeq,
    rawConfigOptions: [],
    promptCapabilities: { image: false, audio: false, embeddedContext: false },
    normalizedControls: {
      extras: [],
      model: null,
      mode: modeControl(modeId),
      reasoning: null,
      effort: null,
      fastMode: null,
      collaborationMode: null,
    },
  } as SessionLiveConfigSnapshot;
}

function modeControl(currentValue: string): NormalizedSessionControl {
  return {
    key: "mode",
    rawConfigId: "mode",
    label: "Mode",
    settable: true,
    currentValue,
    values: ["default", "plan", "bypass"].map((value) => ({ value, label: value })),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
