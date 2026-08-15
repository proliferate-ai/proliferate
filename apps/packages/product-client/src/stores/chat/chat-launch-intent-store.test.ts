import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatLaunchIntent } from "#product/lib/domain/chat/launch/launch-intent";
import {
  EMPTY_CHAT_LAUNCH_INTENT_REGISTRY,
} from "#product/lib/domain/chat/launch/launch-intent-registry";
import { useChatLaunchIntentStore } from "#product/stores/chat/chat-launch-intent-store";

function intent(overrides: Partial<ChatLaunchIntent> = {}): ChatLaunchIntent {
  return {
    id: "launch-1",
    promptId: "prompt-1",
    text: "Build the thing",
    contentParts: [{ type: "text", text: "Build the thing" }],
    targetKind: "cowork",
    retryInput: {
      text: "Build the thing",
      modelSelection: { kind: "codex", modelId: "gpt-5.4" },
      modeId: null,
      target: { kind: "cowork" },
    },
    materializedWorkspaceId: null,
    materializedSessionId: null,
    attemptId: null,
    targetWorkspaceId: null,
    createdAt: 100,
    sendAttemptedAt: null,
    failure: null,
    ...overrides,
  };
}

function storedIntent(intentId: string): ChatLaunchIntent | null {
  return useChatLaunchIntentStore.getState().intentsById[intentId] ?? null;
}

describe("chat launch intent store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    useChatLaunchIntentStore.setState({
      intentsById: EMPTY_CHAT_LAUNCH_INTENT_REGISTRY.intentsById,
      intentOrder: EMPTY_CHAT_LAUNCH_INTENT_REGISTRY.intentOrder,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the first launch intent verbatim when a second one begins", () => {
    const first = intent();
    useChatLaunchIntentStore.getState().begin(first);
    useChatLaunchIntentStore.getState().begin(intent({
      id: "launch-2",
      promptId: "prompt-2",
      text: "New task",
    }));

    expect(useChatLaunchIntentStore.getState().intentOrder).toEqual(["launch-1", "launch-2"]);
    // Not merely present: untouched. A second submit must not smear its own
    // prompt, ids, or timestamps over the launch already running.
    expect(storedIntent("launch-1")).toEqual(first);
    expect(storedIntent("launch-2")?.text).toBe("New task");
  });

  it("clears one launch intent and leaves the other running", () => {
    useChatLaunchIntentStore.getState().begin(intent());
    useChatLaunchIntentStore.getState().begin(intent({ id: "launch-2" }));

    useChatLaunchIntentStore.getState().clear("launch-1");

    expect(useChatLaunchIntentStore.getState().intentOrder).toEqual(["launch-2"]);
    expect(storedIntent("launch-1")).toBeNull();
    expect(storedIntent("launch-2")).not.toBeNull();
  });

  it("fails the named launch intent only", () => {
    useChatLaunchIntentStore.getState().begin(intent());
    useChatLaunchIntentStore.getState().begin(intent({ id: "launch-2" }));

    useChatLaunchIntentStore.getState().fail("launch-2", {
      message: "boom",
      retryMode: "safe",
    });

    expect(storedIntent("launch-1")?.failure).toBeNull();
    expect(storedIntent("launch-2")?.failure).toEqual({
      message: "boom",
      retryMode: "safe",
      failedAt: Date.now(),
    });
  });

  it("ignores mutators for an intent that is not in the registry", () => {
    useChatLaunchIntentStore.getState().begin(intent({ id: "launch-2" }));
    const before = useChatLaunchIntentStore.getState().intentsById;

    useChatLaunchIntentStore.getState().clear("launch-1");
    useChatLaunchIntentStore.getState().fail("launch-1", {
      message: "old failure",
      retryMode: "safe",
    });
    useChatLaunchIntentStore.getState().markSendAttempted("launch-1");
    useChatLaunchIntentStore.getState().markMaterialized("launch-1", {
      workspaceId: "workspace-old",
    });

    expect(useChatLaunchIntentStore.getState().intentsById).toBe(before);
  });

  it("marks send attempts per intent, once", () => {
    useChatLaunchIntentStore.getState().begin(intent());
    useChatLaunchIntentStore.getState().begin(intent({ id: "launch-2" }));

    useChatLaunchIntentStore.getState().markSendAttempted("launch-2");
    expect(storedIntent("launch-1")?.sendAttemptedAt).toBeNull();
    expect(storedIntent("launch-2")?.sendAttemptedAt).toBe(Date.now());

    vi.advanceTimersByTime(5_000);
    useChatLaunchIntentStore.getState().markSendAttempted("launch-2");
    expect(storedIntent("launch-2")?.sendAttemptedAt)
      .toBe(new Date("2026-01-01T00:00:00.000Z").getTime());
  });

  it("marks materialized workspace, session and attempt per intent", () => {
    useChatLaunchIntentStore.getState().begin(intent());
    useChatLaunchIntentStore.getState().begin(intent({ id: "launch-2" }));

    useChatLaunchIntentStore.getState().markMaterialized("launch-2", {
      workspaceId: "workspace-1",
      sessionId: "session-1",
      attemptId: "attempt-1",
    });

    expect(storedIntent("launch-1")?.materializedWorkspaceId).toBeNull();
    expect(storedIntent("launch-1")?.attemptId).toBeNull();
    expect(storedIntent("launch-2")?.materializedWorkspaceId).toBe("workspace-1");
    expect(storedIntent("launch-2")?.materializedSessionId).toBe("session-1");
    expect(storedIntent("launch-2")?.attemptId).toBe("attempt-1");
  });

  it("defaults attemptId and targetWorkspaceId to null on begin", () => {
    useChatLaunchIntentStore.getState().begin(intent({ id: "launch-3" }));

    expect(storedIntent("launch-3")?.attemptId).toBeNull();
    expect(storedIntent("launch-3")?.targetWorkspaceId).toBeNull();
  });
});
