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

let selectedWorkspaceId: string | null = "workspace-1";
vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: { selectedWorkspaceId: string | null }) => unknown) =>
    selector({ selectedWorkspaceId }),
}));

let bootstrappedWorkspaceIds = new Set<string>();
vi.mock("#product/hooks/workspaces/lifecycle/workspace-bootstrap-memory", () => ({
  hasWorkspaceBootstrappedInSession: (workspaceId: string) => bootstrappedWorkspaceIds.has(workspaceId),
}));

import { ChatLoadingHero } from "./ChatLoadingHero";

beforeEach(() => {
  vi.useFakeTimers();
  substepState.substep = "loading-history";
  substepState.caption = "Loading conversation";
  substepState.workspaceName = "acme/widgets";
  selectedWorkspaceId = "workspace-1";
  bootstrappedWorkspaceIds = new Set();
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
  it("withholds the treatment inside the show delay, then renders the DotCellLoader hero mark, mark-only", () => {
    render(<ChatLoadingHero />);

    expect(document.querySelector("[data-dot-cell-loader]")).toBeNull();

    advance(motion.loading.showDelayMs);

    const mark = document.querySelector("[data-dot-cell-loader]");
    expect(mark).not.toBeNull();
    expect(mark?.getAttribute("data-size")).toBe("hero");
    // No caption/workspace-name copy: the hero renders the mark only.
    expect(screen.queryByText("Loading conversation")).toBeNull();
    expect(screen.queryByText("acme/widgets")).toBeNull();
  });

  it("renders ThinkingText immediately for the awaiting-first-turn substep, bypassing the show-delay", () => {
    substepState.substep = "awaiting-first-turn";
    substepState.caption = null;
    substepState.workspaceName = null;

    render(<ChatLoadingHero />);

    // Positive assertion: the thinking copy is present before any timers run,
    // because this branch is agent-activity feedback, not a loading
    // treatment, and must not be withheld behind the show-delay.
    expect(document.querySelector("[data-thinking-text]")).not.toBeNull();
    expect(screen.getAllByText("Thinking").length).toBeGreaterThan(0);
    expect(document.querySelector("[data-dot-cell-loader]")).toBeNull();

    advance(motion.loading.showDelayMs);

    expect(document.querySelector("[data-thinking-text]")).not.toBeNull();
    expect(document.querySelector("[data-dot-cell-loader]")).toBeNull();
  });

  it("never mounts the hero mark for a workspace already bootstrapped in this session", () => {
    bootstrappedWorkspaceIds.add("workspace-1");

    const { container } = render(<ChatLoadingHero />);

    advance(motion.loading.showDelayMs);

    expect(document.querySelector("[data-dot-cell-loader]")).toBeNull();
    expect(document.querySelector("[data-chat-loading-hero]")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("negative control: a non-bootstrapped workspace does mount the hero mark after the show delay", () => {
    bootstrappedWorkspaceIds.add("some-other-workspace");

    render(<ChatLoadingHero />);
    advance(motion.loading.showDelayMs);

    expect(document.querySelector("[data-dot-cell-loader]")).not.toBeNull();
  });
});
