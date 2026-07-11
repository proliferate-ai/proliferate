/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatLaunchIntentPane } from "./ChatLaunchIntentPane";
import type { ChatLaunchIntent } from "@/lib/domain/chat/launch/launch-intent";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";

vi.mock("@/hooks/chat/workflows/use-chat-launch-intent-actions", () => ({
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

  it("uses the same bottom-anchored frontier and footer geometry as a pending transcript row", () => {
    useChatLaunchIntentStore.getState().begin(intent());

    const { container } = render(
      <ChatLaunchIntentPane
        bottomInsetPx={96}
        nonDisplacingBottomInsetPx={32}
      />,
    );

    expect(screen.getByText("Start cowork")).not.toBeNull();
    // Launch dispatch says "Thinking" (same voice as agent work). The
    // ThinkingText shimmer renders the label on a data-thinking-text span.
    expect(
      screen
        .getByText("Thinking", { selector: "[data-thinking-text]" })
        .closest("[data-chat-user-message]"),
    ).toBeNull();

    const anchorFrame = container.querySelector("[data-chat-launch-intent-anchor-frame]");
    const turn = container.querySelector("[data-chat-launch-intent-turn]");
    const frontier = container.querySelector("[data-chat-launch-intent-frontier]");
    const statusFrame = frontier?.querySelector("[data-working-status-frame]");
    const footer = container.querySelector("[data-turn-assistant-footer]");
    const bottomInset = container.querySelector("[data-chat-launch-intent-bottom-inset]");
    const overlayInset = container.querySelector("[data-chat-launch-intent-overlay-inset]");

    expect(anchorFrame?.className).toContain("mt-auto");
    expect(anchorFrame?.parentElement?.className).toContain("flex");
    expect(anchorFrame?.parentElement?.className).toContain("min-h-full");
    expect(turn?.className).toContain("gap-4");
    expect(statusFrame?.className).toContain("h-6");
    expect(frontier?.nextElementSibling).toBe(footer);
    expect(footer?.querySelector("[data-turn-assistant-footer-slot]")?.className).toContain("h-6");
    expect(bottomInset?.className).toContain("shrink-0");
    expect(bottomInset?.getAttribute("style")).toContain("height: 64px");
    expect(overlayInset?.className).toContain("absolute");
    expect(overlayInset?.className).toContain("top-full");
    expect(overlayInset?.getAttribute("style")).toContain("height: 32px");
    expect(screen.getByTitle("Copy message").closest("[data-chat-user-message]")).not.toBeNull();
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
