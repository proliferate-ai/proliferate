// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOptimisticPendingPrompt,
} from "@proliferate/product-model/chats/pending-prompts/pending-prompts";
import {
  createPromptOutboxEntry,
  type PromptOutboxEntry,
} from "@proliferate/product-model/sessions/intents/session-intent-model";
import { TranscriptPendingPromptRow } from "./TranscriptPendingPromptRow";

const NOW = "2026-05-20T17:00:00.000Z";

describe("TranscriptPendingPromptRow", () => {
  afterEach(() => {
    cleanup();
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
    expect(container.innerHTML).toContain("text-[length:var(--text-chat)]");
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
