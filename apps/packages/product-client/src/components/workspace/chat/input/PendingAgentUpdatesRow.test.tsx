// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PendingAgentUpdatesRow } from "#product/components/workspace/chat/input/PendingAgentUpdatesRow";
import {
  derivePendingPromptQueueRow,
  type PendingPromptQueueEntry,
} from "#product/domain/chats/pending-prompts/pending-prompt-queue";
import { groupPendingAgentUpdates } from "#product/domain/chats/pending-prompts/pending-agent-updates";

function agentEntry(seq: number, sessionId: string, label: string): PendingPromptQueueEntry {
  return {
    seq,
    text: "pointer body",
    contentParts: [{ type: "text", text: "pointer body" }],
    isBeingEdited: false,
    promptProvenance: { type: "agentWake", targetSessionId: sessionId, label },
  };
}

function updatesFor(...entries: PendingPromptQueueEntry[]) {
  const updates = groupPendingAgentUpdates({ rows: entries.map(derivePendingPromptQueueRow) });
  if (!updates) {
    throw new Error("expected agent updates");
  }
  return updates;
}

describe("PendingAgentUpdatesRow", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows overlapping glyphs, a count, and when they land — and nothing else", () => {
    const { container } = render(
      <PendingAgentUpdatesRow
        updates={updatesFor(
          agentEntry(1, "sess-audit", "Audit retry schema"),
          agentEntry(2, "sess-audit", "Audit retry schema"),
          agentEntry(3, "sess-docs", "Docs pass"),
        )}
        onOpenAgent={() => {}}
      />,
    );

    expect(container.querySelectorAll("[data-pending-agent-update-glyph]")).toHaveLength(2);
    expect(container.textContent).toContain("3 updates");
    expect(container.textContent).toContain("delivered next turn");
    // You see THAT, not WHAT: no bodies, and no edit/delete/preview affordances.
    expect(container.textContent).not.toContain("pointer body");
    expect(screen.queryByLabelText(/edit/i)).toBeNull();
    expect(screen.queryByLabelText(/delete|remove/i)).toBeNull();
    // Overlapping stack.
    expect(container.innerHTML).toContain("-space-x-1.5");
  });

  it("opens that agent's session from its glyph", () => {
    const onOpenAgent = vi.fn();
    render(
      <PendingAgentUpdatesRow
        updates={updatesFor(agentEntry(1, "sess-audit", "Audit retry schema"))}
        onOpenAgent={onOpenAgent}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Audit retry schema · 1 queued update — click to open" }),
    );
    expect(onOpenAgent).toHaveBeenCalledWith("sess-audit");
  });

  it("renders a static glyph when there is nothing to open", () => {
    const { container } = render(
      <PendingAgentUpdatesRow updates={updatesFor(agentEntry(1, "sess-audit", "Audit retry schema"))} />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelectorAll("[data-pending-agent-update-glyph]")).toHaveLength(1);
  });
});
