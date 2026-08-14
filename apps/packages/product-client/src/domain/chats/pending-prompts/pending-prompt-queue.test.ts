import { describe, expect, it } from "vitest";
import type { ContentPart } from "@anyharness/sdk";
import {
  derivePendingPromptQueueRow,
  derivePendingPromptQueueRows,
  findNewestEditablePendingPrompt,
  type PendingPromptQueueEntry,
} from "./pending-prompt-queue";

function entry(overrides: Partial<PendingPromptQueueEntry> = {}): PendingPromptQueueEntry {
  return {
    seq: 1,
    text: "Queued text",
    contentParts: [],
    isBeingEdited: false,
    promptProvenance: null,
    ...overrides,
  };
}

describe("derivePendingPromptQueueRow", () => {
  it("derives editable plain text rows with collapsed whitespace", () => {
    expect(derivePendingPromptQueueRow(entry({
      promptId: "prompt-1",
      text: "first line\n\nsecond line",
    }))).toMatchObject({
      key: "seq:1",
      seq: 1,
      kind: "plain",
      label: "first line second line",
      isBeingEdited: false,
      showEditAction: true,
      canEdit: true,
      showDeleteAction: true,
      canDelete: true,
    });
  });

  it("keys rows by queue seq and reserves prompt id for local reconciliation", () => {
    const beforeAck = derivePendingPromptQueueRow(entry({
      seq: -10,
      promptId: "prompt-stable",
    }));
    const afterAck = derivePendingPromptQueueRow(entry({
      seq: 42,
      promptId: "prompt-stable",
    }));

    expect(beforeAck.key).toBe("seq:-10");
    expect(afterAck.key).toBe("seq:42");
    expect(beforeAck.showEditAction).toBe(true);
    expect(beforeAck.canEdit).toBe(false);
    expect(beforeAck.editDisabledReason).toBe("Available once queued");
    expect(beforeAck.showDeleteAction).toBe(true);
    expect(beforeAck.canDelete).toBe(false);
    expect(beforeAck.deleteDisabledReason).toBe("Available once queued");
    expect(afterAck.canDelete).toBe(true);
    expect(afterAck.deleteAction).toBe("runtime");
  });

  it("edits runtime rows by stable seq even when prompt id is null", () => {
    expect(derivePendingPromptQueueRow(entry({ promptId: null }))).toMatchObject({
      key: "seq:1",
      showEditAction: true,
      canEdit: true,
      showDeleteAction: true,
      canDelete: true,
    });
  });

  it("keeps duplicate prompt ids distinct by immutable queue seq", () => {
    const first = derivePendingPromptQueueRow(entry({ seq: 4, promptId: "duplicate" }));
    const second = derivePendingPromptQueueRow(entry({ seq: 9, promptId: "duplicate" }));

    expect(first.key).toBe("seq:4");
    expect(second.key).toBe("seq:9");
    expect(first.key).not.toBe(second.key);
  });

  it("allows local queued prompts to be cancelled before dispatch", () => {
    expect(derivePendingPromptQueueRow(entry({
      seq: -20,
      promptId: "prompt-local",
      localOutboxDeliveryState: "waiting_for_session",
    }))).toMatchObject({
      showEditAction: true,
      canEdit: true,
      showDeleteAction: true,
      canDelete: true,
      deleteAction: "cancel_local",
    });
  });

  it("reserves disabled actions while a local prompt waits for runtime acknowledgement", () => {
    expect(derivePendingPromptQueueRow(entry({
      seq: -22,
      promptId: "prompt-dispatching",
      localOutboxDeliveryState: "dispatching",
    }))).toMatchObject({
      showEditAction: true,
      canEdit: false,
      editDisabledReason: "Available once queued",
      showDeleteAction: true,
      canDelete: false,
      deleteDisabledReason: "Available once queued",
      deleteAction: null,
    });
  });

  it("allows ambiguous local queued prompts to be dismissed", () => {
    expect(derivePendingPromptQueueRow(entry({
      seq: -21,
      promptId: "prompt-unknown",
      localOutboxDeliveryState: "unknown_after_dispatch",
    }))).toMatchObject({
      showDeleteAction: true,
      canDelete: true,
      deleteAction: "dismiss_local",
    });
  });

  it("summarizes structured content and prevents editing", () => {
    const contentParts: ContentPart[] = [
      { type: "text", text: "Review these" },
      {
        type: "image",
        attachmentId: "image-1",
        mimeType: "image/png",
        name: "screenshot.png",
        size: 2048,
      },
      {
        type: "resource",
        attachmentId: "file-1",
        uri: "file:///README.md",
        name: "README.md",
        mimeType: "text/markdown",
        size: 1024,
        preview: "# Readme",
      },
      {
        type: "resource_link",
        uri: "https://example.com/spec",
        name: "spec",
        description: "Spec",
      },
      {
        type: "plan_reference",
        planId: "plan-1",
        title: "Implementation Plan",
        bodyMarkdown: "# Plan",
        snapshotHash: "hash-1",
        sourceSessionId: "session-1",
        sourceKind: "codex",
      },
    ];

    expect(derivePendingPromptQueueRow(entry({ contentParts, text: "" }))).toMatchObject({
      kind: "plain",
      label: "Review these [image: screenshot.png] [file: README.md] [link: spec] [plan: Implementation Plan]",
      showEditAction: false,
      canEdit: false,
      showDeleteAction: true,
      canDelete: true,
    });
  });

  it("hides subagent wake prompt bodies and exposes no controls", () => {
    const row = derivePendingPromptQueueRow(entry({
      text: [
        "Subagent update",
        "Agent: runtime-server-sdk-survey (subagent-runtime-server-sdk-survey)",
        "Outcome: completed",
        "",
        "Final output:",
        "Mapped the runtime, server, and SDK seams.",
      ].join("\n"),
      promptProvenance: {
        type: "subagentWake",
        sessionLinkId: "link-1",
        completionId: "completion-1",
        label: "runtime-server-sdk-survey",
      },
    }));

    expect(row).toMatchObject({
      kind: "agent_updates",
      label: "From subagents",
      canEdit: false,
      canDelete: false,
      agentUpdateCount: 1,
    });
    expect(row.label).not.toContain("Child session");
  });

  it("formats review feedback ready rows from the first line", () => {
    const row = derivePendingPromptQueueRow(entry({
      text: "Review feedback is ready.\n\nHidden critique body",
      promptProvenance: {
        type: "reviewFeedback",
        reviewRunId: "run-1",
        reviewRoundId: "round-1",
        feedbackJobId: "job-1",
      },
    }));

    expect(row).toMatchObject({
      kind: "review_feedback",
      label: "Review feedback ready",
      canEdit: false,
      canDelete: true,
    });
    expect(row.label).not.toContain("Hidden critique");
  });

  it("formats review complete rows from the first line", () => {
    expect(derivePendingPromptQueueRow(entry({
      text: "Review is complete.\n\nAll reviewers approved",
      promptProvenance: {
        type: "reviewFeedback",
        reviewRunId: "run-1",
        reviewRoundId: "round-2",
        feedbackJobId: "job-2",
      },
    }))).toMatchObject({
      kind: "review_feedback",
      label: "Review complete",
    });
  });

  it("prefers review provenance labels", () => {
    expect(derivePendingPromptQueueRow(entry({
      text: "Review feedback is ready.\n\nHidden critique body",
      promptProvenance: {
        type: "reviewFeedback",
        reviewRunId: "run-1",
        reviewRoundId: "round-1",
        feedbackJobId: "job-1",
        label: "Reviewer notes ready",
      },
    }))).toMatchObject({
      kind: "review_feedback",
      label: "Reviewer notes ready",
    });
  });

  it("supports legacy review feedback provenance", () => {
    expect(derivePendingPromptQueueRow(entry({
      text: "Review feedback is ready.\n\nReview run: run-1\nRound: 1",
      promptProvenance: {
        type: "system",
        label: "review_feedback",
      },
    }))).toMatchObject({
      kind: "review_feedback",
      label: "Review feedback ready",
    });
  });

  it("falls back for unknown review feedback text", () => {
    expect(derivePendingPromptQueueRow(entry({
      text: "Unexpected first line\n\nHidden critique body",
      promptProvenance: {
        type: "reviewFeedback",
        reviewRunId: "run-1",
        reviewRoundId: "round-1",
        feedbackJobId: "job-1",
      },
    }))).toMatchObject({
      kind: "review_feedback",
      label: "Review feedback ready",
    });
  });
});

describe("derivePendingPromptQueueRows", () => {
  it("returns no aggregate for zero agent updates", () => {
    expect(derivePendingPromptQueueRows([entry({ seq: 1, text: "User message" })]))
      .toHaveLength(1);
    expect(derivePendingPromptQueueRows([])).toEqual([]);
  });

  it("places one agent aggregate after every user row", () => {
    const rows = derivePendingPromptQueueRows([
      entry({ seq: 1, text: "First user message" }),
      entry({
        seq: 2,
        text: "Exact hidden agent reply",
        promptProvenance: {
          type: "agentSession",
          sourceSessionId: "agent-session-1",
          label: "Schema audit",
        },
      }),
      entry({ seq: 3, text: "Second user message" }),
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["plain", "plain", "agent_updates"]);
    expect(rows.at(-1)).toMatchObject({
      key: "agent-updates",
      label: "From subagents",
      agentUpdateCount: 1,
      agentUpdateSeqs: [2],
      agents: [{
        sessionId: "agent-session-1",
        title: "Schema audit",
        updateCount: 1,
        provenance: {
          kind: "agent_session",
          sessionLinkId: null,
          relation: null,
        },
      }],
      showEditAction: false,
      showDeleteAction: false,
    });
    expect(rows.at(-1)?.label).not.toContain("Exact hidden");
  });

  it("deduplicates durable glyph identities while counting every update", () => {
    const rows = derivePendingPromptQueueRows([
      entry({
        seq: 2,
        promptProvenance: {
          type: "agentSession",
          sourceSessionId: "agent-session-1",
          label: "Schema audit",
        },
      }),
      entry({
        seq: 4,
        promptProvenance: {
          type: "agentSession",
          sourceSessionId: "agent-session-1",
          label: "Schema audit",
        },
      }),
      entry({
        seq: 6,
        promptProvenance: {
          type: "subagentWake",
          sessionLinkId: "link-2",
          completionId: "completion-2",
          label: "Tests",
        },
      }),
      entry({
        seq: 8,
        promptProvenance: {
          type: "subagentWake",
          sessionLinkId: "link-unresolved",
          completionId: "completion-unresolved",
          label: "Not projected yet",
        },
      }),
    ], {
      "completion-2": {
        relation: "subagent",
        completionId: "completion-2",
        sessionLinkId: "link-2",
        parentSessionId: "parent",
        childSessionId: "agent-session-2",
        childTurnId: "turn-2",
        childLastEventSeq: 12,
        outcome: "completed",
        label: "Tests",
        seq: 13,
        timestamp: "2026-08-10T00:00:00Z",
      },
    });
    const aggregate = rows[0]!;

    expect(aggregate.agentUpdateCount).toBe(4);
    expect(aggregate.agentUpdateSeqs).toEqual([2, 4, 6, 8]);
    expect(aggregate.agents).toEqual([
      {
        sessionId: "agent-session-1",
        title: "Schema audit",
        updateCount: 2,
        provenance: {
          kind: "agent_session",
          sessionLinkId: null,
          relation: null,
        },
      },
      {
        sessionId: "agent-session-2",
        title: "Tests",
        updateCount: 1,
        provenance: {
          kind: "subagent_wake",
          sessionLinkId: "link-2",
          relation: "subagent",
        },
      },
    ]);
    expect(aggregate.agents).toHaveLength(2);
  });

  it("preserves linked cowork provenance without inferring navigation location", () => {
    const rows = derivePendingPromptQueueRows([
      entry({
        seq: 9,
        promptProvenance: {
          type: "linkWake",
          relation: "cowork_coding_session",
          sessionLinkId: "cowork-link-1",
          completionId: "cowork-completion-1",
          label: "Coding pass",
        },
      }),
    ], {
      "cowork-completion-1": {
        relation: "cowork_coding_session",
        completionId: "cowork-completion-1",
        sessionLinkId: "cowork-link-1",
        parentSessionId: "parent",
        childSessionId: "cowork-session-1",
        childTurnId: "turn-cowork",
        childLastEventSeq: 20,
        outcome: "completed",
        label: "Coding pass",
        seq: 21,
        timestamp: "2026-08-10T00:00:00Z",
      },
    });

    expect(rows[0]?.agents).toEqual([{
      sessionId: "cowork-session-1",
      title: "Coding pass",
      updateCount: 1,
      provenance: {
        kind: "link_wake",
        sessionLinkId: "cowork-link-1",
        relation: "cowork_coding_session",
      },
    }]);
  });
});

describe("findNewestEditablePendingPrompt", () => {
  it("skips a newer non-editable system row", () => {
    const editable = entry({ seq: 4, promptId: null, text: "Editable runtime prompt" });
    const wake = entry({
      seq: 9,
      promptId: "wake-prompt",
      text: "Hidden wake body",
      promptProvenance: {
        type: "subagentWake",
        sessionLinkId: "link-1",
        completionId: "completion-1",
        label: "reviewer",
      },
    });

    expect(findNewestEditablePendingPrompt([editable, wake])).toBe(editable);
  });

  it("returns null when every queued prompt is non-editable", () => {
    const dispatching = entry({
      seq: -2,
      promptId: "dispatching",
      localOutboxDeliveryState: "dispatching",
    });
    expect(findNewestEditablePendingPrompt([dispatching])).toBeNull();
  });
});
