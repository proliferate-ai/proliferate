// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceGitStatus } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";
import {
  useWorkspacePeek,
  WORKSPACE_PEEK_DELAY_MS,
  type WorkspacePeekContent,
} from "#product/components/workspace/shell/sidebar/WorkspacePeekCard";

function makeGitStatus(overrides: Partial<WorkspaceGitStatus> = {}): WorkspaceGitStatus {
  return {
    branch: "pro-112-search-popover",
    dirty: false,
    conflicted: false,
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    pr: {
      state: "open",
      number: 805,
      url: "https://github.com/acme/repo/pull/805",
      checks: "pending",
      reviewDecision: "none",
    },
    attention: "none",
    capturedAt: "2026-08-13T10:00:00.000Z",
    source: "live",
    ...overrides,
  };
}

function content(overrides: Partial<WorkspacePeekContent> = {}): WorkspacePeekContent {
  return {
    name: "Find active sessions",
    time: "38m ago",
    repo: "proliferate",
    branch: "pro-112-search-popover",
    gitStatus: makeGitStatus(),
    ...overrides,
  };
}

function PeekHarness({ peek }: { peek: WorkspacePeekContent | null }) {
  const { onPointerEnter, onPointerLeave, peekCard } = useWorkspacePeek(peek);
  return (
    <>
      <div
        data-testid="row"
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        Row
      </div>
      {peekCard}
    </>
  );
}

function hoverRow() {
  fireEvent.pointerEnter(screen.getByTestId("row"));
}

function card(): HTMLElement | null {
  return document.querySelector("[data-workspace-peek-card]");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useWorkspacePeek", () => {
  it("waits out the hover delay before showing anything", () => {
    render(<PeekHarness peek={content()} />);

    hoverRow();
    act(() => {
      vi.advanceTimersByTime(WORKSPACE_PEEK_DELAY_MS - 1);
    });
    expect(card()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(card()).not.toBeNull();
  });

  it("never opens for a pointer that passes straight over the row", () => {
    render(<PeekHarness peek={content()} />);

    hoverRow();
    fireEvent.pointerLeave(screen.getByTestId("row"));
    act(() => {
      vi.advanceTimersByTime(WORKSPACE_PEEK_DELAY_MS * 2);
    });

    expect(card()).toBeNull();
  });

  it("closes immediately when the pointer leaves", () => {
    render(<PeekHarness peek={content()} />);

    hoverRow();
    act(() => {
      vi.advanceTimersByTime(WORKSPACE_PEEK_DELAY_MS);
    });
    expect(card()).not.toBeNull();

    fireEvent.pointerLeave(screen.getByTestId("row"));
    expect(card()).toBeNull();
  });
});

describe("WorkspacePeekCard", () => {
  function openPeek(peek: WorkspacePeekContent) {
    render(<PeekHarness peek={peek} />);
    hoverRow();
    act(() => {
      vi.advanceTimersByTime(WORKSPACE_PEEK_DELAY_MS);
    });
  }

  it("shows the git context the row no longer carries", () => {
    openPeek(content());

    expect(screen.getByText("Find active sessions")).toBeTruthy();
    expect(screen.getByText("38m ago")).toBeTruthy();
    expect(screen.getByText("proliferate")).toBeTruthy();
    expect(screen.getByText("pro-112-search-popover")).toBeTruthy();
    expect(screen.getByText("PR #805 · Open · Checks pending")).toBeTruthy();
    expect(screen.getByText("Checks pending")).toBeTruthy();
  });

  it("stays out of the pointer's way", () => {
    openPeek(content());

    expect(card()?.className).toContain("pointer-events-none");
    expect(card()?.getAttribute("aria-hidden")).toBe("true");
  });

  it("anchors below and inside the row, clamped to the viewport", () => {
    openPeek(content());

    // jsdom reports a zero rect, so this is the clamped floor: the card never
    // escapes the viewport margin even for a row at the origin.
    expect(card()?.style.left).toBe("28px");
    expect(card()?.style.top).toBe("8px");
  });

  it("omits the PR row when the branch has no pull request", () => {
    openPeek(content({
      gitStatus: makeGitStatus({
        pr: { state: "none", number: null, url: null, checks: "none", reviewDecision: "none" },
      }),
    }));

    expect(screen.queryByText(/^PR #/)).toBeNull();
    expect(screen.getByText("No CI checks")).toBeTruthy();
  });

  it("omits rows it has nothing to say in", () => {
    openPeek(content({ time: null, repo: null, branch: null, gitStatus: null }));

    expect(screen.getByText("Find active sessions")).toBeTruthy();
    expect(screen.queryByText("proliferate")).toBeNull();
    expect(screen.getByText("No CI checks")).toBeTruthy();
  });
});
