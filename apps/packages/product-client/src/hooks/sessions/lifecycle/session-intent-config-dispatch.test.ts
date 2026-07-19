import type { SetSessionConfigOptionResponse } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONFIG_INTENT_DISPATCH_TIMEOUT_MS,
  dispatchConfigIntent,
  type ConfigIntentDispatchDeps,
} from "#product/hooks/sessions/lifecycle/session-intent-config-dispatch";
import {
  pendingConfigChangesForSessionIntents,
} from "@proliferate/product-domain/sessions/intents/session-intent-selectors";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";

const mocks = vi.hoisted(() => ({
  getSessionClientAndWorkspace: vi.fn(),
  mutateAsync: vi.fn(),
}));

vi.mock("#product/lib/access/anyharness/session-runtime", () => ({
  getSessionClientAndWorkspace: mocks.getSessionClientAndWorkspace,
}));

describe("dispatchConfigIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mutateAsync.mockReset();
    useSessionIntentStore.getState().clear();
    mocks.getSessionClientAndWorkspace.mockResolvedValue({
      workspaceId: "workspace-1",
      materializedSessionId: "runtime-session-1",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops the optimistic intent and reports runtime rejection language", async () => {
    const intent = useSessionIntentStore.getState().enqueueConfig({
      intentId: "config-plan",
      clientSessionId: "session-1",
      materializedSessionId: "runtime-session-1",
      workspaceId: "workspace-1",
      configId: "collaboration_mode",
      value: "plan",
    });
    const onFailure = vi.fn();
    mocks.mutateAsync.mockRejectedValue(new Error("request timed out"));

    await dispatchConfigIntent(intent, createDeps(onFailure));

    expect(useSessionIntentStore.getState().entriesById[intent.intentId]).toMatchObject({
      status: "failed",
      errorMessage: "request timed out",
    });
    expect(onFailure).toHaveBeenCalledWith("request timed out");
  });

  it("times out a stalled request, rolls back once, and ignores its late completion", async () => {
    vi.useFakeTimers();
    const intent = useSessionIntentStore.getState().enqueueConfig({
      intentId: "config-plan",
      clientSessionId: "session-1",
      materializedSessionId: "runtime-session-1",
      workspaceId: "workspace-1",
      configId: "collaboration_mode",
      value: "plan",
    });
    const request = deferred<SetSessionConfigOptionResponse>();
    const onFailure = vi.fn();
    const deps = createDeps(onFailure);
    let signal: AbortSignal | undefined;
    mocks.mutateAsync.mockImplementation((input) => {
      signal = input.requestOptions?.signal;
      return request.promise;
    });

    const dispatch = dispatchConfigIntent(intent, deps);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CONFIG_INTENT_DISPATCH_TIMEOUT_MS);
    await dispatch;

    const failed = useSessionIntentStore.getState().entriesById[intent.intentId];
    expect(failed).toMatchObject({
      status: "failed",
      errorMessage: "request timed out",
    });
    expect(pendingConfigChangesForSessionIntents(failed ? [failed] : []))
      .not.toHaveProperty("collaboration_mode");
    expect(signal?.aborted).toBe(true);
    expect(onFailure).toHaveBeenCalledTimes(1);

    request.resolve(configResponse("plan"));
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.upsertWorkspaceSessionRecord).not.toHaveBeenCalled();
    expect(useSessionIntentStore.getState().entriesById[intent.intentId]).toMatchObject({
      status: "failed",
    });
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("keeps ordinary successful settlement intact", async () => {
    const intent = useSessionIntentStore.getState().enqueueConfig({
      intentId: "config-plan",
      clientSessionId: "session-1",
      materializedSessionId: "runtime-session-1",
      workspaceId: "workspace-1",
      configId: "collaboration_mode",
      value: "plan",
    });
    const onFailure = vi.fn();
    const deps = createDeps(onFailure);
    mocks.mutateAsync.mockResolvedValue(configResponse("plan"));

    await dispatchConfigIntent(intent, deps);

    expect(useSessionIntentStore.getState().entriesById[intent.intentId]).toMatchObject({
      status: "accepted",
      applyState: "applied",
    });
    expect(deps.upsertWorkspaceSessionRecord).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
    expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      requestOptions: { signal: expect.any(AbortSignal) },
    }));
  });
});

function createDeps(onFailure: (message: string) => void): ConfigIntentDispatchDeps {
  return {
    cloudClient: null,
    getWorkspaceSurface: vi.fn(),
    setSessionConfigOptionMutation: {
      mutateAsync: mocks.mutateAsync,
    } as unknown as ConfigIntentDispatchDeps["setSessionConfigOptionMutation"],
    upsertWorkspaceSessionRecord: vi.fn(),
    onFailure,
  };
}

function configResponse(modeId: string): SetSessionConfigOptionResponse {
  return {
    applyState: "applied",
    session: {
      id: "runtime-session-1",
      workspaceId: "workspace-1",
      agentKind: "claude",
      modelId: "claude-sonnet-4-6",
      modeId,
      status: "idle",
      title: null,
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
    },
  } as SetSessionConfigOptionResponse;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
