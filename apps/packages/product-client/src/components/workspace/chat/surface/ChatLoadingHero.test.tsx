// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { motion } from "@proliferate/design/motion";

const substepState = {
  substep: "loading-history" as string,
  caption: "Loading conversation" as string | null,
  workspaceName: "acme/widgets" as string | null,
};

vi.mock("#product/hooks/chat/derived/use-chat-loading-substep", () => ({
  useChatLoadingSubstep: () => substepState,
}));

import { ChatLoadingHero } from "./ChatLoadingHero";

beforeEach(() => {
  vi.useFakeTimers();
  substepState.substep = "loading-history";
  substepState.caption = "Loading conversation";
  substepState.workspaceName = "acme/widgets";
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("ChatLoadingHero", () => {
  it("withholds the treatment inside the show delay, then renders the Class A living mark with captions", () => {
    render(<ChatLoadingHero />);

    expect(document.querySelector("[data-brand-mark]")).toBeNull();
    expect(document.querySelector("[data-dot-cell-loader]")).toBeNull();

    advance(motion.loading.showDelayMs);

    expect(document.querySelector("[data-brand-mark]")).not.toBeNull();
    // Negative control: the old DotCellLoader wave never mounts on this surface.
    expect(document.querySelector("[data-dot-cell-loader]")).toBeNull();
    expect(screen.getByText("Loading conversation")).not.toBeNull();
    expect(screen.getByText("acme/widgets")).not.toBeNull();
  });

  it("keeps ThinkingText, not the mark, for the awaiting-first-turn substep", () => {
    substepState.substep = "awaiting-first-turn";
    substepState.caption = null;
    substepState.workspaceName = null;

    render(<ChatLoadingHero />);
    advance(motion.loading.showDelayMs);

    expect(document.querySelector("[data-brand-mark]")).toBeNull();
    expect(document.querySelector("[data-dot-cell-loader]")).toBeNull();
  });
});
