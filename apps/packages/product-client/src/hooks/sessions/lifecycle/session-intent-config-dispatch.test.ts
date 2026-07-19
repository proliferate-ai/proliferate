import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchConfigIntent,
  type ConfigIntentDispatchDeps,
} from "#product/hooks/sessions/lifecycle/session-intent-config-dispatch";
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
    useSessionIntentStore.getState().clear();
    mocks.getSessionClientAndWorkspace.mockResolvedValue({
      workspaceId: "workspace-1",
      materializedSessionId: "runtime-session-1",
    });
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
