import { beforeEach, describe, expect, it } from "vitest";
import type { ModelSupportRefusal } from "#product/lib/domain/chat/models/model-support-refusals";
import { useModelSupportStore } from "#product/stores/chat/model-support-store";

function refusal(overrides: Partial<ModelSupportRefusal> = {}): ModelSupportRefusal {
  return {
    workspaceId: "ws-1",
    agentKind: "claude",
    modelId: "opus-9",
    detail: "model 'opus-9' is not supported for agent 'claude'",
    ...overrides,
  };
}

describe("model support store", () => {
  beforeEach(() => {
    useModelSupportStore.setState({ refusalsByKey: {}, pickerRequestNonce: 0 });
  });

  it("records one refusal per workspace, harness and model", () => {
    const { recordRefusal } = useModelSupportStore.getState();
    recordRefusal(refusal());
    recordRefusal(refusal({ workspaceId: "ws-2" }));
    recordRefusal(refusal({ modelId: "opus-8" }));

    expect(Object.keys(useModelSupportStore.getState().refusalsByKey)).toHaveLength(3);
  });

  it("keeps state identity when the same refusal repeats, so subscribers do not churn", () => {
    const { recordRefusal } = useModelSupportStore.getState();
    recordRefusal(refusal());
    const first = useModelSupportStore.getState().refusalsByKey;
    recordRefusal(refusal());

    expect(useModelSupportStore.getState().refusalsByKey).toBe(first);
  });

  it("forgets only the named workspace's refusals", () => {
    const { recordRefusal, clearWorkspace } = useModelSupportStore.getState();
    recordRefusal(refusal());
    recordRefusal(refusal({ workspaceId: "ws-2" }));

    clearWorkspace("ws-1");

    const remaining = Object.values(useModelSupportStore.getState().refusalsByKey);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].workspaceId).toBe("ws-2");
  });

  it("keeps state identity when a clear matches nothing", () => {
    const { recordRefusal, clearWorkspace } = useModelSupportStore.getState();
    recordRefusal(refusal());
    const before = useModelSupportStore.getState().refusalsByKey;

    clearWorkspace("ws-unrelated");

    expect(useModelSupportStore.getState().refusalsByKey).toBe(before);
  });

  it("bumps the picker nonce every time, so a second refusal reopens the picker", () => {
    const { requestPicker } = useModelSupportStore.getState();
    requestPicker();
    expect(useModelSupportStore.getState().pickerRequestNonce).toBe(1);
    requestPicker();
    expect(useModelSupportStore.getState().pickerRequestNonce).toBe(2);
  });
});
