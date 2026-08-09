import { describe, expect, it } from "vitest";
import {
  derivePendingPromptQueueRow,
  type PendingPromptQueueEntry,
} from "#product/domain/chats/pending-prompts/pending-prompt-queue";
import { groupPendingAgentUpdates } from "#product/lib/domain/chat/composer/pending-agent-updates";

function entry(
  seq: number,
  provenance: PendingPromptQueueEntry["promptProvenance"],
  text = "queued body",
): PendingPromptQueueEntry {
  return {
    seq,
    text,
    contentParts: [{ type: "text", text }],
    isBeingEdited: false,
    promptProvenance: provenance,
  };
}

function rows(...entries: PendingPromptQueueEntry[]) {
  return entries.map(derivePendingPromptQueueRow);
}

describe("groupPendingAgentUpdates", () => {
  it("collapses agent-queued entries into one glyph per agent with a count", () => {
    const updates = groupPendingAgentUpdates({
      rows: rows(
        entry(1, { type: "subagentWake", sessionLinkId: "link-a", completionId: "c1", label: "Audit retry schema" }),
        entry(2, { type: "subagentWake", sessionLinkId: "link-a", completionId: "c2", label: "Audit retry schema" }),
        entry(3, { type: "agentWake", targetSessionId: "sess-docs", label: "Docs pass" }),
      ),
      sessionIdByLinkId: { "link-a": "sess-audit" },
    });

    expect(updates?.groups).toHaveLength(2);
    expect(updates?.totalCount).toBe(3);
    expect(updates?.countLabel).toBe("3 updates");
    expect(updates?.groups[0]?.count).toBe(2);
    expect(updates?.groups[0]?.sessionId).toBe("sess-audit");
    // Hover says how many and that it opens — never what the updates say. ADR
    // §4 fixes the wording: "N queued · click to open".
    expect(updates?.groups[0]?.hoverLabel).toBe("2 queued · click to open");
    expect(updates?.groups[1]?.hoverLabel).toBe("1 queued · click to open");
  });

  it("never counts the human's own queued messages", () => {
    expect(groupPendingAgentUpdates({ rows: rows(entry(1, null, "Check the DLQ sizing")) })).toBeNull();

    const mixed = groupPendingAgentUpdates({
      rows: rows(
        entry(1, null, "Check the DLQ sizing"),
        entry(2, { type: "agentWake", targetSessionId: "sess-docs", label: "Docs pass" }),
      ),
    });
    expect(mixed?.totalCount).toBe(1);
  });

  it("counts a queued agent message, not just a wake pointer", () => {
    const updates = groupPendingAgentUpdates({
      rows: rows(entry(1, { type: "agentSession", sourceSessionId: "sess-peer", label: "Fix dispatch" })),
    });

    expect(updates?.totalCount).toBe(1);
    expect(updates?.groups[0]?.sessionId).toBe("sess-peer");
  });

  it("stays unopenable when nothing resolved a session to open", () => {
    const updates = groupPendingAgentUpdates({
      rows: rows(entry(1, { type: "subagentWake", sessionLinkId: "link-a", completionId: "c1", label: "Audit" })),
    });

    expect(updates?.groups[0]?.sessionId).toBeNull();
    expect(updates?.groups[0]?.hoverLabel).toBe("1 queued");
  });
});
