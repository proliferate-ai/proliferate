import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatLaunchIntent } from "@/lib/domain/chat/launch/launch-intent";
import { useChatLaunchIntentStore } from "./chat-launch-intent-store";

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
    createdAt: 100,
    sendAttemptedAt: null,
    failure: null,
    ...overrides,
  };
}

describe("chat launch intent store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    useChatLaunchIntentStore.setState({ activeIntent: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("replaces the active launch intent when a new one begins", () => {
    useChatLaunchIntentStore.getState().begin(intent());
    useChatLaunchIntentStore.getState().begin(intent({
      id: "launch-2",
      promptId: "prompt-2",
      text: "New task",
    }));

    expect(useChatLaunchIntentStore.getState().activeIntent?.id).toBe("launch-2");
    expect(useChatLaunchIntentStore.getState().activeIntent?.text).toBe("New task");
  });

  it("does not let stale settlement clear the active launch intent", () => {
    useChatLaunchIntentStore.getState().begin(intent({ id: "launch-2" }));

    useChatLaunchIntentStore.getState().clearIfActive("launch-1");

    expect(useChatLaunchIntentStore.getState().activeIntent?.id).toBe("launch-2");
  });

  it("does not let stale settlement fail the active launch intent", () => {
    useChatLaunchIntentStore.getState().begin(intent({ id: "launch-2" }));

    useChatLaunchIntentStore.getState().failIfActive("launch-1", {
      message: "old failure",
      retryMode: "safe",
    });

    expect(useChatLaunchIntentStore.getState().activeIntent?.failure).toBeNull();
  });

  it("marks send attempts only for the active launch intent", () => {
    useChatLaunchIntentStore.getState().begin(intent({ id: "launch-2" }));

    useChatLaunchIntentStore.getState().markSendAttemptedIfActive("launch-1");
    expect(useChatLaunchIntentStore.getState().activeIntent?.sendAttemptedAt).toBeNull();

    useChatLaunchIntentStore.getState().markSendAttemptedIfActive("launch-2");
    expect(useChatLaunchIntentStore.getState().activeIntent?.sendAttemptedAt).toBe(Date.now());
  });

  it("marks materialized workspace and session only for the active launch intent", () => {
    useChatLaunchIntentStore.getState().begin(intent({ id: "launch-2" }));

    useChatLaunchIntentStore.getState().markMaterializedIfActive("launch-1", {
      workspaceId: "workspace-old",
      sessionId: "session-old",
    });
    expect(useChatLaunchIntentStore.getState().activeIntent?.materializedWorkspaceId)
      .toBeNull();

    useChatLaunchIntentStore.getState().markMaterializedIfActive("launch-2", {
      workspaceId: "workspace-1",
      sessionId: "session-1",
    });

    expect(useChatLaunchIntentStore.getState().activeIntent?.materializedWorkspaceId)
      .toBe("workspace-1");
    expect(useChatLaunchIntentStore.getState().activeIntent?.materializedSessionId)
      .toBe("session-1");
  });
});
