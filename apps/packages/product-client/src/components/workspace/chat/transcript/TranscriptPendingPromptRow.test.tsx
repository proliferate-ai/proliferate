// @vitest-environment jsdom

import { type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createTranscriptState } from "@anyharness/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOptimisticPendingPrompt,
} from "#product/domain/chats/pending-prompts/pending-prompts";
import {
  createPromptOutboxEntry,
  type PromptOutboxEntry,
} from "#product/domain/sessions/intents/session-intent-model";
import { TranscriptPendingPromptRow as TranscriptPendingPromptRowImpl } from "#product/components/workspace/chat/transcript/TranscriptPendingPromptRow";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import {
  EMPTY_PENDING_WORKSPACE_REGISTRY,
  upsertPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";

const NOW = "2026-05-20T17:00:00.000Z";
const TRANSCRIPT = createTranscriptState("session-1");

function TranscriptPendingPromptRow(
  props: Omit<ComponentProps<typeof TranscriptPendingPromptRowImpl>, "transcript" | "workspaceId">,
) {
  return (
    <TranscriptPendingPromptRowImpl
      {...props}
      transcript={TRANSCRIPT}
      workspaceId="workspace-1"
    />
  );
}

describe("TranscriptPendingPromptRow", () => {
  afterEach(() => {
    cleanup();
    useSessionSelectionStore.setState({
      pendingWorkspaces: EMPTY_PENDING_WORKSPACE_REGISTRY,
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
    });
  });

  it("renders closed-session send failures as a compact line", () => {
    const actions = {
      retryPrompt: vi.fn(),
      dismissPrompt: vi.fn(),
    };
    const { container } = render(
      <TranscriptPendingPromptRow
        activeSessionId="session-1"
        rowIndex={0}
        prompt={createOptimisticPendingPrompt(
          "This prompt should not stay in a large failed bubble.",
          "prompt-1",
          NOW,
        )}
        outboxEntry={failedOutboxEntry("session is closed")}
        optimisticTrailingStatus={null}
        outboxActions={actions}
      />,
    );

    const statusLine = screen.getByText("Not sent");
    expect(statusLine.parentElement?.textContent).toBe("Not sent: session is closed");
    expect(container.querySelector("[data-chat-user-message]")).toBeNull();
    expect(container.innerHTML).not.toContain("min-h-[calc");
    expect(statusLine.closest("[data-chat-transcript-ignore]")?.className).toContain("text-chat");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(actions.dismissPrompt).toHaveBeenCalledWith("prompt-1");
    expect(actions.retryPrompt).not.toHaveBeenCalled();
  });

  it("keeps retry available for non-closed send failures", () => {
    const actions = {
      retryPrompt: vi.fn(),
      dismissPrompt: vi.fn(),
    };
    render(
      <TranscriptPendingPromptRow
        activeSessionId="session-1"
        rowIndex={0}
        prompt={createOptimisticPendingPrompt("Try again", "prompt-1", NOW)}
        outboxEntry={failedOutboxEntry("network dropped")}
        optimisticTrailingStatus={null}
        outboxActions={actions}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(actions.retryPrompt).toHaveBeenCalledWith("prompt-1");
  });

  it("shows an actionable retry when projected session launch requires login", () => {
    const actions = {
      retryPrompt: vi.fn(),
      dismissPrompt: vi.fn(),
    };
    render(
      <TranscriptPendingPromptRow
        activeSessionId="client-session:claude:1"
        rowIndex={0}
        prompt={createOptimisticPendingPrompt("Run after login", "prompt-1", NOW)}
        outboxEntry={failedOutboxEntry(
          "agent 'claude' is not ready (status: LoginRequired)",
        )}
        optimisticTrailingStatus={null}
        outboxActions={actions}
      />,
    );

    expect(screen.getByText(/LoginRequired/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(actions.retryPrompt).toHaveBeenCalledWith("prompt-1");
  });

  it("shows the delivery error and retry for unconfirmed dispatches", () => {
    const actions = {
      retryPrompt: vi.fn(),
      dismissPrompt: vi.fn(),
    };
    const { container } = render(
      <TranscriptPendingPromptRow
        activeSessionId="session-1"
        rowIndex={0}
        prompt={createOptimisticPendingPrompt("Did this land?", "prompt-1", NOW)}
        outboxEntry={unknownAfterDispatchOutboxEntry("Internal error")}
        optimisticTrailingStatus={null}
        outboxActions={actions}
      />,
    );

    const status = screen.getByText("Waiting for confirmation…");
    expect(status.textContent).toContain("Internal error");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(actions.retryPrompt).toHaveBeenCalledWith("prompt-1");
    expect(actions.dismissPrompt).toHaveBeenCalledWith("prompt-1");

    const frontier = container.querySelector("[data-pending-frontier]");
    const footer = container.querySelector("[data-turn-assistant-footer]");
    const retry = screen.getByRole("button", { name: "Retry" });
    const turn = frontier?.parentElement;
    expect(turn ? [...turn.children].indexOf(retry.parentElement!) : -1)
      .toBeLessThan(turn ? [...turn.children].indexOf(frontier!) : -1);
    expect(frontier?.nextElementSibling).toBe(footer);
    expect(footer?.nextElementSibling).toBeNull();
  });

  it("renders transcript waits as quiet transcript text", () => {
    const { container } = render(
      <TranscriptPendingPromptRow
        activeSessionId="session-1"
        rowIndex={0}
        prompt={createOptimisticPendingPrompt("Still waiting", "prompt-1", NOW)}
        outboxEntry={acceptedRunningOutboxEntry()}
        optimisticTrailingStatus={null}
        outboxActions={{
          retryPrompt: vi.fn(),
          dismissPrompt: vi.fn(),
        }}
      />,
    );

    const status = screen.getByText("Waiting for transcript…");
    const statusLine = status.closest("div");
    expect(statusLine?.className).toContain("text-chat");
    expect(statusLine?.className).toContain("font-normal");
    expect(statusLine?.className).toContain("text-muted-foreground");
    // [CHAT-04] RULED turn rhythm: the 12px --spacing-transcript-turn token.
    expect(container.querySelector("[class~='gap-transcript-turn']")).not.toBeNull();
    expect(container.innerHTML).not.toContain("gap-3.5");
    expect(container.innerHTML).not.toContain("thinking-text");
  });

  it("keeps the pending frontier above the fixed assistant footer", () => {
    const { container } = render(
      <TranscriptPendingPromptRow
        activeSessionId="session-1"
        rowIndex={0}
        prompt={createOptimisticPendingPrompt("Keep the anchor still", "prompt-1", NOW)}
        outboxEntry={null}
        optimisticTrailingStatus={<div data-testid="thinking">Thinking</div>}
        outboxActions={{
          retryPrompt: vi.fn(),
          dismissPrompt: vi.fn(),
        }}
      />,
    );

    const frontier = container.querySelector("[data-pending-frontier]");
    const footer = container.querySelector("[data-turn-assistant-footer]");
    expect(frontier?.nextElementSibling).toBe(footer);
    expect(footer?.querySelector("[data-turn-assistant-footer-slot]")?.className).toContain("h-6");
  });

  it("renders a pending agent reply as a right receipt instead of a user bubble", () => {
    const prompt = {
      ...createOptimisticPendingPrompt("Exact pending agent reply", "prompt-agent", NOW),
      promptProvenance: {
        type: "agentSession" as const,
        sourceSessionId: "agent-session-1",
        label: "Schema audit",
      },
    };
    const { container } = render(
      <TranscriptPendingPromptRow
        activeSessionId="session-1"
        rowIndex={0}
        prompt={prompt}
        outboxEntry={null}
        optimisticTrailingStatus={null}
        outboxActions={{ retryPrompt: vi.fn(), dismissPrompt: vi.fn() }}
      />,
    );

    expect(container.querySelector("[data-agent-origin-prompt]")?.className).toContain("justify-end");
    expect(container.querySelector("[data-agent-message-receipt]")?.textContent)
      .toContain("Schema audit");
    expect(container.querySelector("[data-chat-user-message]")).toBeNull();
    expect(container.textContent).not.toContain("Exact pending agent reply");
  });

  it("hosts the receipt alone while the workspace creation is still in flight", () => {
    const pendingEntry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-1",
      selectedWorkspaceId: null,
      source: "worktree-created",
      displayName: "Worktree",
      request: { kind: "local", sourceRoot: "/tmp/workspace-1" },
    });
    useSessionSelectionStore.setState({
      pendingWorkspaces: upsertPendingWorkspaceEntry(
        EMPTY_PENDING_WORKSPACE_REGISTRY,
        pendingEntry,
      ),
      selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(pendingEntry),
    });
    const { container } = render(
      <TranscriptPendingPromptRow
        activeSessionId="session-1"
        rowIndex={0}
        prompt={createOptimisticPendingPrompt("Make me a worktree", "prompt-1", NOW)}
        outboxEntry={null}
        optimisticTrailingStatus={<div data-testid="thinking">Thinking</div>}
        outboxActions={{
          retryPrompt: vi.fn(),
          dismissPrompt: vi.fn(),
        }}
        workspaceReceipt={<div data-testid="receipt">Creating worktree</div>}
      />,
    );

    expect(screen.queryByTestId("thinking")).toBeNull();
    const receipt = screen.getByTestId("receipt");
    const frontier = container.querySelector("[data-pending-frontier]");
    expect(frontier?.contains(receipt)).toBe(true);
  });

  it("renders the working status below the settled receipt until the first turn lands (PRO-119)", () => {
    // No pending workspace entry: the creation settled, the session exists,
    // and the prompt is in flight — the frontier must not read as a dead
    // session while the agent boots.
    const { container } = render(
      <TranscriptPendingPromptRow
        activeSessionId="session-1"
        rowIndex={0}
        prompt={createOptimisticPendingPrompt("Make me a worktree", "prompt-1", NOW)}
        outboxEntry={null}
        optimisticTrailingStatus={<div data-testid="thinking">Thinking</div>}
        outboxActions={{
          retryPrompt: vi.fn(),
          dismissPrompt: vi.fn(),
        }}
        workspaceReceipt={<div data-testid="receipt">Worktree created</div>}
      />,
    );

    const frontier = container.querySelector("[data-pending-frontier]");
    expect(frontier?.contains(screen.getByTestId("receipt"))).toBe(true);
    expect(frontier?.contains(screen.getByTestId("thinking"))).toBe(true);
  });

  it("keeps the failed_before_dispatch line unaffected by the workspaceReceipt prop", () => {
    const actions = {
      retryPrompt: vi.fn(),
      dismissPrompt: vi.fn(),
    };
    render(
      <TranscriptPendingPromptRow
        activeSessionId="session-1"
        rowIndex={0}
        prompt={createOptimisticPendingPrompt("Not sent", "prompt-1", NOW)}
        outboxEntry={failedOutboxEntry("network dropped")}
        optimisticTrailingStatus={null}
        outboxActions={actions}
        workspaceReceipt={<div data-testid="receipt">Creating worktree</div>}
      />,
    );

    expect(screen.queryByTestId("receipt")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(actions.retryPrompt).toHaveBeenCalledWith("prompt-1");
  });
});

function failedOutboxEntry(errorMessage: string): PromptOutboxEntry {
  return {
    ...createPromptOutboxEntry({
      clientPromptId: "prompt-1",
      clientSessionId: "session-1",
      text: "Queued prompt text",
      blocks: [{ type: "text", text: "Queued prompt text" }],
      now: NOW,
    }),
    status: "failed",
    deliveryState: "failed_before_dispatch",
    errorMessage,
    updatedAt: NOW,
  };
}

function unknownAfterDispatchOutboxEntry(errorMessage: string): PromptOutboxEntry {
  return {
    ...createPromptOutboxEntry({
      clientPromptId: "prompt-1",
      clientSessionId: "session-1",
      text: "Queued prompt text",
      blocks: [{ type: "text", text: "Queued prompt text" }],
      now: NOW,
    }),
    status: "dispatching",
    deliveryState: "unknown_after_dispatch",
    dispatchedAt: NOW,
    errorMessage,
    updatedAt: NOW,
  };
}

function acceptedRunningOutboxEntry(): PromptOutboxEntry {
  return {
    ...createPromptOutboxEntry({
      clientPromptId: "prompt-1",
      clientSessionId: "session-1",
      text: "Queued prompt text",
      blocks: [{ type: "text", text: "Queued prompt text" }],
      now: "2026-05-20T16:59:00.000Z",
    }),
    status: "accepted",
    deliveryState: "accepted_running",
    acceptedAt: "2026-05-20T16:59:00.000Z",
    dispatchedAt: "2026-05-20T16:59:00.000Z",
    updatedAt: "2026-05-20T16:59:00.000Z",
  };
}
