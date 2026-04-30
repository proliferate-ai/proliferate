import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDeferredHomeLaunchId,
  useDeferredHomeLaunchStore,
  type DeferredHomeLaunch,
} from "./deferred-home-launch-store";

function launch(overrides: Partial<DeferredHomeLaunch> = {}): DeferredHomeLaunch {
  return {
    id: "cloud-1:attempt-1",
    status: "pending",
    workspaceId: "cloud:cloud-1",
    cloudWorkspaceId: "cloud-1",
    cloudAttemptId: "attempt-1",
    agentKind: "codex",
    modelId: "gpt-5.4",
    modeId: null,
    promptText: "private prompt",
    promptId: "prompt-1",
    launchIntentId: "launch-1",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("deferred home launch store", () => {
  beforeEach(() => {
    useDeferredHomeLaunchStore.setState({ launches: {} });
  });

  it("derives stable ids from cloud workspace and attempt ids", () => {
    expect(buildDeferredHomeLaunchId({
      cloudWorkspaceId: "cloud-1",
      attemptId: "attempt-1",
    })).toBe("cloud-1:attempt-1");
  });

  it("atomically marks pending launches as consuming once", () => {
    const state = useDeferredHomeLaunchStore.getState();
    state.enqueue(launch());

    expect(useDeferredHomeLaunchStore.getState().markConsuming("cloud-1:attempt-1")).toBe(true);
    expect(useDeferredHomeLaunchStore.getState().launches["cloud-1:attempt-1"]?.status)
      .toBe("consuming");
    expect(useDeferredHomeLaunchStore.getState().markConsuming("cloud-1:attempt-1")).toBe(false);
  });

  it("returns consuming launches to pending for retry", () => {
    const state = useDeferredHomeLaunchStore.getState();
    state.enqueue(launch({ status: "consuming" }));

    useDeferredHomeLaunchStore.getState().markPending("cloud-1:attempt-1");

    expect(useDeferredHomeLaunchStore.getState().launches["cloud-1:attempt-1"]?.status)
      .toBe("pending");
  });

  it("clears launches by workspace", () => {
    const state = useDeferredHomeLaunchStore.getState();
    state.enqueue(launch());
    state.enqueue(launch({
      id: "cloud-2:attempt-2",
      workspaceId: "cloud:cloud-2",
      cloudWorkspaceId: "cloud-2",
      cloudAttemptId: "attempt-2",
    }));

    useDeferredHomeLaunchStore.getState().clearForWorkspace("cloud:cloud-1");

    expect(Object.keys(useDeferredHomeLaunchStore.getState().launches)).toEqual([
      "cloud-2:attempt-2",
    ]);
  });
});
