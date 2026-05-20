/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatLaunchIntentPane } from "./ChatLaunchIntentPane";
import type { ChatLaunchIntent } from "@/lib/domain/chat/launch/launch-intent";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";

vi.mock("@/hooks/chat/use-chat-launch-intent-actions", () => ({
  useChatLaunchIntentActions: () => ({
    dismiss: vi.fn(),
    isRetrying: false,
    retry: vi.fn(),
    returnHome: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useChatLaunchIntentStore.setState({ activeIntent: null });
});

describe("ChatLaunchIntentPane", () => {
  it("renders pending thinking outside the right-aligned user message", () => {
    useChatLaunchIntentStore.getState().begin(intent());

    render(<ChatLaunchIntentPane bottomInsetPx={0} />);

    expect(screen.getByText("Start cowork")).not.toBeNull();
    expect(screen.getByText("Thinking").closest("[data-chat-user-message]")).toBeNull();
  });
});

function intent(): ChatLaunchIntent {
  return {
    id: "launch-1",
    promptId: "prompt-1",
    text: "Start cowork",
    contentParts: [],
    targetKind: "cowork",
    retryInput: {
      text: "Start cowork",
      modelSelection: { kind: "agent", modelId: "model-1" },
      modeId: null,
      target: { kind: "cowork" },
    },
    materializedWorkspaceId: null,
    materializedSessionId: null,
    createdAt: 1_700_000_000_000,
    sendAttemptedAt: null,
    failure: null,
  } as ChatLaunchIntent;
}
