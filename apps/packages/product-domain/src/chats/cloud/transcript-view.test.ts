import { describe, expect, it } from "vitest";
import type { ContentPart, SessionEventEnvelope } from "@anyharness/sdk";
import type {
  CloudPendingInteraction,
  CloudSessionEvent,
  CloudTranscriptItem,
} from "@proliferate/cloud-sdk";

import {
  buildCloudTranscriptState,
  buildCloudTranscriptView,
  cloudPendingInteractionsRequireProjectedRows,
  cloudTranscriptHasAgentProgressAfterPrompt,
  cloudTranscriptHasUserPrompt,
} from "./transcript-view";

describe("buildCloudTranscriptState", () => {
  it("returns TranscriptState when retained envelopes are renderable and current", () => {
    const state = buildCloudTranscriptState({
      sessionId: "session-1",
      events: [
        eventEnvelope(1, "item_completed", userEnvelope(1, "hello from envelope")),
      ],
      fallbackItems: [],
    });

    expect(state.source).toBe("events");
    expect(state.fallbackReason).toBeNull();
    expect(state.envelopeCount).toBe(1);
    expect(state.missingEnvelopeCount).toBe(0);
    expect(state.latestEnvelopeSeq).toBe(1);
    expect(state.transcript?.sessionMeta.sessionId).toBe("session-1");
    expect(state.transcript?.itemsById["user-1"]).toEqual(expect.objectContaining({
      kind: "user_message",
      text: "hello from envelope",
    }));
  });

  it("synthesizes TranscriptState from projection when retained events lack envelopes", () => {
    const state = buildCloudTranscriptState({
      sessionId: "session-1",
      events: [
        {
          targetId: "target-1",
          sessionId: "session-1",
          seq: 2,
          eventType: "item_completed",
          sourceKind: "runtime",
          envelope: null,
        },
      ],
      fallbackItems: [
        {
          itemId: "item-1",
          turnId: "turn-1",
          kind: "assistant_message",
          status: "completed",
          text: "projection-only assistant",
          firstSeq: 2,
          lastSeq: 2,
        },
      ],
    });

    expect(state.source).toBe("projection");
    expect(state.transcript?.sessionMeta.sessionId).toBe("session-1");
    expect(state.transcript?.itemsById["item-1"]).toEqual(expect.objectContaining({
      kind: "assistant_prose",
      text: "projection-only assistant",
    }));
    expect(state.envelopeCount).toBe(0);
    expect(state.missingEnvelopeCount).toBe(1);
    expect(state.latestProjectedSeq).toBe(2);
    expect(state.fallbackReason).toBe("missing_envelopes");
  });

  it("uses synthetic projection state when projected items are ahead of event-backed rows", () => {
    const state = buildCloudTranscriptState({
      sessionId: "session-1",
      events: [
        eventEnvelope(1, "item_completed", userEnvelope(1, "event-backed prompt")),
      ],
      fallbackItems: [
        {
          itemId: "item-1",
          turnId: "turn-1",
          kind: "user_message",
          status: "completed",
          text: "event-backed prompt",
          firstSeq: 1,
          lastSeq: 1,
        },
        {
          itemId: "item-2",
          turnId: "turn-1",
          kind: "assistant_message",
          status: "completed",
          text: "projection is newer",
          firstSeq: 2,
          lastSeq: 2,
        },
      ],
    });

    expect(state.source).toBe("projection");
    expect(state.transcript?.turnOrder).toEqual(["turn-1"]);
    expect(state.transcript?.itemsById["item-2"]).toEqual(expect.objectContaining({
      kind: "assistant_prose",
      text: "projection is newer",
    }));
    expect(state.envelopeCount).toBe(1);
    expect(state.missingEnvelopeCount).toBe(0);
    expect(state.latestEnvelopeSeq).toBe(1);
    expect(state.latestProjectedSeq).toBe(2);
    expect(state.fallbackReason).toBe("projection_ahead_of_events");
  });

  it("uses projection when mixed retained events omit older projected transcript rows", () => {
    const state = buildCloudTranscriptState({
      sessionId: "session-1",
      events: [
        {
          targetId: "target-1",
          sessionId: "session-1",
          seq: 1,
          eventType: "item_completed",
          sourceKind: "runtime",
          envelope: null,
        },
        eventEnvelope(3, "item_completed", assistantEnvelope(3, "event-backed latest")),
      ],
      fallbackItems: [
        {
          itemId: "item-1",
          turnId: "turn-1",
          kind: "user_message",
          status: "completed",
          text: "projection-only prompt",
          firstSeq: 1,
          lastSeq: 1,
        },
        {
          itemId: "assistant-3",
          turnId: "turn-1",
          kind: "assistant_message",
          status: "completed",
          text: "event-backed latest",
          firstSeq: 3,
          lastSeq: 3,
        },
      ],
    });

    expect(state.source).toBe("projection");
    expect(state.fallbackReason).toBe("missing_envelopes");
    expect(state.transcript?.itemsById["item-1"]).toEqual(expect.objectContaining({
      kind: "user_message",
      text: "projection-only prompt",
    }));
  });
});

describe("cloudPendingInteractionsRequireProjectedRows", () => {
  it("requires projected rows for cloud-only permission affordances", () => {
    expect(cloudPendingInteractionsRequireProjectedRows([
      pendingPermissionInteraction({
        requestId: "permission-1",
        requestedSeq: 5,
        toolCallId: "tool-1",
        title: "npm test",
      }),
    ])).toBe(true);
  });

  it("allows shared transcript state for pending prompt echoes", () => {
    expect(cloudPendingInteractionsRequireProjectedRows([
      pendingPromptInteraction({
        requestId: "prompt-1",
        requestedSeq: 1,
        text: "hello",
      }),
    ])).toBe(false);
  });
});

describe("buildCloudTranscriptView", () => {
  it("falls back to projected transcript items when retained events lack envelopes", () => {
    const events: CloudSessionEvent[] = [
      {
        targetId: "target-1",
        sessionId: "session-1",
        seq: 1,
        eventType: "item_completed",
        sourceKind: "runtime",
        envelope: null,
      },
    ];
    const fallbackItems: CloudTranscriptItem[] = [
      {
        itemId: "item-1",
        turnId: "turn-1",
        kind: "user_message",
        status: "completed",
        text: "hello from projection",
        firstSeq: 1,
        lastSeq: 1,
      },
    ];

    const view = buildCloudTranscriptView({
      sessionId: "session-1",
      events,
      fallbackItems,
    });

    expect(view.source).toBe("projection");
    expect(view.missingEnvelopeCount).toBe(1);
    expect(view.rows).toEqual([
      expect.objectContaining({
        body: "hello from projection",
        kind: "user",
      }),
    ]);
  });

  it("shows projected shell commands as command rows with inline detail", () => {
    const command = "pnpm test -- --runInBand";
    const fallbackItems: CloudTranscriptItem[] = [
      {
        itemId: "tool-1",
        turnId: "turn-1",
        kind: "tool_invocation",
        status: "completed",
        title: command,
        text: null,
        payload: {
          event: {
            item: {
              kind: "tool_invocation",
              nativeToolName: "Bash",
              toolKind: "execute",
              title: command,
              toolCallId: "tool-1",
              contentParts: [
                {
                  type: "tool_call",
                  nativeToolName: "Bash",
                  toolKind: "execute",
                  title: command,
                  toolCallId: "tool-1",
                },
              ],
            },
          },
        },
        firstSeq: 4,
        lastSeq: 8,
      },
    ];

    const view = buildCloudTranscriptView({
      sessionId: "session-1",
      events: [],
      fallbackItems,
    });

    expect(view.rows).toEqual([
      expect.objectContaining({
        kind: "tool",
        title: "Command",
        detail: command,
        status: "completed",
        sourceToolCallId: "tool-1",
      }),
    ]);
  });

  it("uses event rows when some retained envelopes are missing and projection is empty", () => {
    const events: CloudSessionEvent[] = [
      {
        targetId: "target-1",
        sessionId: "session-1",
        seq: 1,
        eventType: "item_completed",
        sourceKind: "runtime",
        envelope: userEnvelope(1, "hello from envelope"),
      },
      {
        targetId: "target-1",
        sessionId: "session-1",
        seq: 2,
        eventType: "session_state_update",
        sourceKind: "runtime",
        envelope: null,
      },
    ];

    const view = buildCloudTranscriptView({
      sessionId: "session-1",
      events,
      fallbackItems: [],
    });

    expect(view.source).toBe("events");
    expect(view.missingEnvelopeCount).toBe(1);
    expect(view.rows).toEqual([
      expect.objectContaining({
        body: "hello from envelope",
        kind: "user",
        firstSeq: 1,
        lastSeq: 1,
      }),
    ]);
  });

  it("uses retained permission command titles for event-backed tool rows", () => {
    const command = "uname -a && free -h";
    const events: CloudSessionEvent[] = [
      {
        targetId: "target-1",
        sessionId: "session-1",
        seq: 4,
        eventType: "item_started",
        sourceKind: "runtime",
        envelope: toolStartEnvelope(4, "tool-1"),
      },
      {
        targetId: "target-1",
        sessionId: "session-1",
        seq: 5,
        eventType: "interaction_requested",
        sourceKind: "runtime",
        envelope: interactionRequestedEnvelope(5, "tool-1", command),
      },
    ];

    const view = buildCloudTranscriptView({
      sessionId: "session-1",
      events,
      fallbackItems: [],
    });

    expect(view.rows).toEqual([
      expect.objectContaining({
        kind: "tool",
        title: "Command",
        detail: command,
        sourceToolCallId: "tool-1",
      }),
    ]);
  });

  it("does not show generic action counts under collapsed work-history summaries", () => {
    const events: CloudSessionEvent[] = [
      eventEnvelope(1, "turn_started", turnStartedEnvelope(1)),
      eventEnvelope(2, "item_completed", userEnvelope(2, "ZCZCX")),
      eventEnvelope(3, "item_completed", readToolCompletedEnvelope(3, "read-1")),
      eventEnvelope(4, "item_completed", assistantEnvelope(4, "Still here.")),
      eventEnvelope(5, "turn_ended", turnEndedEnvelope(5)),
    ];

    const view = buildCloudTranscriptView({
      sessionId: "session-1",
      events,
      fallbackItems: [],
    });
    const historyRow = view.rows.find((row) => row.title === "Work history");

    expect(historyRow).toEqual(expect.objectContaining({
      kind: "system",
      detail: "1 tool call",
    }));
    expect(historyRow?.children).toEqual([
      expect.objectContaining({
        kind: "tool_group",
        title: "Explored 1 file",
      }),
    ]);
    expect(historyRow?.children?.[0]?.detail).toBeUndefined();
    expect(JSON.stringify(historyRow)).not.toContain("1 action");
  });

  it("uses newer event rows instead of stale projection when later envelopes render", () => {
    const events: CloudSessionEvent[] = [
      {
        targetId: "target-1",
        sessionId: "session-1",
        seq: 1,
        eventType: "item_completed",
        sourceKind: "runtime",
        envelope: userEnvelope(1, "old projection text"),
      },
      {
        targetId: "target-1",
        sessionId: "session-1",
        seq: 2,
        eventType: "item_completed",
        sourceKind: "runtime",
        envelope: userEnvelope(2, "newer event text"),
      },
      {
        targetId: "target-1",
        sessionId: "session-1",
        seq: 3,
        eventType: "session_state_update",
        sourceKind: "runtime",
        envelope: null,
      },
    ];
    const fallbackItems: CloudTranscriptItem[] = [
      {
        itemId: "item-1",
        turnId: "turn-1",
        kind: "user_message",
        status: "completed",
        text: "old projection text",
        firstSeq: 1,
        lastSeq: 1,
      },
    ];

    const view = buildCloudTranscriptView({
      sessionId: "session-1",
      events,
      fallbackItems,
    });

    expect(view.source).toBe("events");
    expect(view.missingEnvelopeCount).toBe(1);
    expect(view.rows).toEqual([
      expect.objectContaining({
        body: "old projection text",
        kind: "user",
        firstSeq: 1,
        lastSeq: 1,
      }),
      expect.objectContaining({
        body: "newer event text",
        kind: "user",
        firstSeq: 2,
        lastSeq: 2,
      }),
    ]);
  });

  it("falls back to projection when a later missing envelope is newer than rendered event rows", () => {
    const events: CloudSessionEvent[] = [
      {
        targetId: "target-1",
        sessionId: "session-1",
        seq: 1,
        eventType: "item_completed",
        sourceKind: "runtime",
        envelope: userEnvelope(1, "rendered from event"),
      },
      {
        targetId: "target-1",
        sessionId: "session-1",
        seq: 3,
        eventType: "item_completed",
        sourceKind: "runtime",
        envelope: null,
      },
    ];
    const fallbackItems: CloudTranscriptItem[] = [
      {
        itemId: "item-1",
        turnId: "turn-1",
        kind: "user_message",
        status: "completed",
        text: "rendered from event",
        firstSeq: 1,
        lastSeq: 1,
      },
      {
        itemId: "item-2",
        turnId: "turn-1",
        kind: "assistant_message",
        status: "completed",
        text: "projection-only assistant",
        firstSeq: 2,
        lastSeq: 2,
      },
    ];

    const view = buildCloudTranscriptView({
      sessionId: "session-1",
      events,
      fallbackItems,
    });

    expect(view.source).toBe("projection");
    expect(view.rows).toEqual([
      expect.objectContaining({
        body: "rendered from event",
        kind: "user",
      }),
      expect.objectContaining({
        body: "projection-only assistant",
        kind: "assistant",
      }),
    ]);
  });

  it("reconciles optimistic prompts from event rows even when old projection items exist", () => {
    const oldItems: CloudTranscriptItem[] = [
      {
        itemId: "old-user",
        turnId: "old-turn",
        kind: "user_message",
        status: "completed",
        text: "old prompt",
        firstSeq: 1,
        lastSeq: 1,
      },
    ];
    const rows = [
      {
        id: "event-user",
        kind: "user" as const,
        body: "repeatable prompt",
        firstSeq: 5,
        lastSeq: 5,
      },
      {
        id: "event-assistant",
        kind: "assistant" as const,
        body: "started",
        firstSeq: 6,
        lastSeq: 6,
      },
    ];
    const prompt = { text: "repeatable prompt", baseTranscriptSeq: 4 };

    expect(cloudTranscriptHasUserPrompt({
      prompt,
      transcriptItems: oldItems,
      transcriptRows: rows,
    })).toBe(true);
    expect(cloudTranscriptHasAgentProgressAfterPrompt({
      prompt,
      transcriptItems: oldItems,
      transcriptRows: rows,
    })).toBe(true);
  });

  it("detects event-row assistant progress after a projected prompt item", () => {
    const items: CloudTranscriptItem[] = [
      {
        itemId: "projected-user",
        turnId: "turn-1",
        kind: "user_message",
        status: "completed",
        text: "new prompt",
        firstSeq: 5,
        lastSeq: 5,
      },
    ];
    const rows = [
      {
        id: "event-assistant",
        kind: "assistant" as const,
        body: "assistant from event",
        firstSeq: 6,
        lastSeq: 6,
      },
    ];

    expect(cloudTranscriptHasAgentProgressAfterPrompt({
      prompt: { text: "new prompt", baseTranscriptSeq: 4 },
      transcriptItems: items,
      transcriptRows: rows,
    })).toBe(true);
  });

  it("does not dedupe a pending repeated prompt against older matching transcript rows", () => {
    const fallbackItems: CloudTranscriptItem[] = [
      {
        itemId: "old-user",
        turnId: "turn-1",
        kind: "user_message",
        status: "completed",
        text: "repeatable prompt",
        firstSeq: 1,
        lastSeq: 1,
      },
      {
        itemId: "old-assistant",
        turnId: "turn-1",
        kind: "assistant_message",
        status: "completed",
        text: "old response",
        firstSeq: 2,
        lastSeq: 2,
      },
    ];
    const pendingInteractions: CloudPendingInteraction[] = [
      pendingPromptInteraction({
        requestId: "prompt-2",
        requestedSeq: 2,
        text: "repeatable prompt",
      }),
    ];

    const view = buildCloudTranscriptView({
      sessionId: "session-1",
      events: [],
      fallbackItems,
      pendingInteractions,
    });

    expect(view.rows).toEqual([
      expect.objectContaining({
        body: "repeatable prompt",
        kind: "user",
      }),
      expect.objectContaining({
        body: "old response",
        kind: "assistant",
      }),
      expect.objectContaining({
        id: "pending-prompt:prompt-2:user",
        body: "repeatable prompt",
        kind: "user",
      }),
      expect.objectContaining({
        id: "pending-prompt:prompt-2:assistant-waiting",
        body: null,
        kind: "assistant",
        streaming: true,
      }),
    ]);
  });

  it("marks projected tool rows that are waiting on permission approval", () => {
    const fallbackItems: CloudTranscriptItem[] = [
      {
        itemId: "tool-1",
        turnId: "turn-1",
        kind: "tool_invocation",
        status: "in_progress",
        text: null,
        payload: {
          event: {
            item: {
              title: "Terminal",
              toolCallId: "tool-1",
            },
          },
        },
        firstSeq: 4,
        lastSeq: 4,
      },
    ];
    const pendingInteractions: CloudPendingInteraction[] = [
      pendingPermissionInteraction({
        requestId: "permission-1",
        requestedSeq: 5,
        toolCallId: "tool-1",
        title: "npm test",
      }),
    ];

    const view = buildCloudTranscriptView({
      sessionId: "session-1",
      events: [],
      fallbackItems,
      pendingInteractions,
    });

    expect(view.rows).toEqual([
      expect.objectContaining({
        kind: "tool",
        title: "Tool call",
        detail: "npm test",
        status: "Needs approval",
        sourceRequestId: "permission-1",
        sourceToolCallId: "tool-1",
      }),
    ]);
  });

  it("adds a standalone permission row when the matching tool row is missing", () => {
    const pendingInteractions: CloudPendingInteraction[] = [
      pendingPermissionInteraction({
        requestId: "permission-1",
        requestedSeq: 5,
        toolCallId: "tool-1",
        title: "npm test",
      }),
    ];

    const view = buildCloudTranscriptView({
      sessionId: "session-1",
      events: [],
      fallbackItems: [],
      pendingInteractions,
    });

    expect(view.rows).toEqual([
      expect.objectContaining({
        id: "pending-permission:permission-1",
        kind: "tool",
        title: "Command",
        detail: "npm test",
        status: "Needs approval",
        sourceRequestId: "permission-1",
        sourceToolCallId: "tool-1",
      }),
    ]);
  });

  it("marks old in-progress tool rows as interrupted once later transcript rows exist", () => {
    const fallbackItems: CloudTranscriptItem[] = [
      {
        itemId: "tool-1",
        turnId: "turn-1",
        kind: "tool_invocation",
        status: "in_progress",
        text: null,
        payload: {
          event: {
            item: {
              title: "Terminal",
              toolCallId: "tool-1",
            },
          },
        },
        firstSeq: 4,
        lastSeq: 4,
      },
      {
        itemId: "assistant-1",
        turnId: "turn-2",
        kind: "assistant_message",
        status: "completed",
        text: "The previous command did not finish.",
        firstSeq: 8,
        lastSeq: 8,
      },
    ];

    const view = buildCloudTranscriptView({
      sessionId: "session-1",
      events: [],
      fallbackItems,
      pendingInteractions: [],
    });

    expect(view.rows).toEqual([
      expect.objectContaining({
        kind: "tool",
        status: "Interrupted",
      }),
      expect.objectContaining({
        kind: "assistant",
      }),
    ]);
  });
});

function userEnvelope(seq: number, text: string): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-05-22T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId: `user-${seq}`,
    event: {
      type: "item_completed",
      item: {
        kind: "user_message",
        status: "completed",
        sourceAgentKind: "codex",
        contentParts: [{ type: "text", text }],
      },
    },
  };
}

function eventEnvelope(
  seq: number,
  eventType: CloudSessionEvent["eventType"],
  envelope: SessionEventEnvelope,
): CloudSessionEvent {
  return {
    targetId: "target-1",
    sessionId: "session-1",
    seq,
    eventType,
    sourceKind: "runtime",
    envelope,
  };
}

function turnStartedEnvelope(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-05-22T00:00:0${seq}Z`,
    turnId: "turn-1",
    event: { type: "turn_started" },
  };
}

function turnEndedEnvelope(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-05-22T00:00:0${seq}Z`,
    turnId: "turn-1",
    event: { type: "turn_ended", stopReason: "end_turn" },
  };
}

function assistantEnvelope(seq: number, text: string): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-05-22T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId: `assistant-${seq}`,
    event: {
      type: "item_completed",
      item: {
        kind: "assistant_message",
        status: "completed",
        sourceAgentKind: "claude",
        contentParts: [{ type: "text", text }],
      },
    },
  };
}

function readToolCompletedEnvelope(seq: number, itemId: string): SessionEventEnvelope {
  const contentParts: ContentPart[] = [
    {
      type: "tool_call",
      toolCallId: itemId,
      title: "Read File",
      toolKind: "read",
      nativeToolName: "Read",
    },
    {
      type: "file_read",
      path: "AGENTS.md",
      basename: "AGENTS.md",
      workspacePath: "AGENTS.md",
      scope: "full",
    },
  ];
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-05-22T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_completed",
      item: {
        kind: "tool_invocation",
        status: "completed",
        sourceAgentKind: "claude",
        title: "Read File",
        nativeToolName: "Read",
        toolKind: "read",
        toolCallId: itemId,
        contentParts,
      },
    },
  };
}

function toolStartEnvelope(seq: number, toolCallId: string): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-05-22T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId: toolCallId,
    event: {
      type: "item_started",
      item: {
        kind: "tool_invocation",
        status: "in_progress",
        sourceAgentKind: "claude",
        title: "Terminal",
        nativeToolName: "Bash",
        toolKind: "execute",
        toolCallId,
        contentParts: [
          {
            type: "tool_call",
            nativeToolName: "Bash",
            title: "Terminal",
            toolCallId,
            toolKind: "execute",
          },
        ],
      },
    },
  };
}

function interactionRequestedEnvelope(
  seq: number,
  toolCallId: string,
  command: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-05-22T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId: toolCallId,
    event: {
      type: "interaction_requested",
      kind: "permission",
      requestId: "permission-1",
      source: {
        toolCallId,
        toolKind: "execute",
      },
      title: command,
      payload: {
        type: "permission",
        options: [
          {
            optionId: "allow",
            label: "Allow",
            kind: "allow_once",
          },
        ],
      },
    },
  };
}

function pendingPromptInteraction(input: {
  requestId: string;
  requestedSeq: number;
  text: string;
}): CloudPendingInteraction {
  return {
    requestId: input.requestId,
    kind: "send_prompt",
    status: "pending",
    title: "Queued prompt",
    description: "Waiting for response.",
    payload: {
      text: input.text,
      promptId: input.requestId,
      commandId: `command-${input.requestId}`,
    },
    requestedSeq: input.requestedSeq,
    resolvedSeq: null,
    requestedAt: "2026-05-22T00:00:00Z",
    resolvedAt: null,
  };
}

function pendingPermissionInteraction(input: {
  requestId: string;
  requestedSeq: number;
  toolCallId: string;
  title: string;
}): CloudPendingInteraction {
  return {
    requestId: input.requestId,
    kind: "permission",
    status: "pending",
    title: input.title,
    description: null,
    payload: {
      itemId: input.toolCallId,
      event: {
        kind: "permission",
        requestId: input.requestId,
        source: {
          toolCallId: input.toolCallId,
          toolKind: "execute",
        },
        title: input.title,
        payload: {
          type: "permission",
          options: [
            {
              optionId: "allow",
              label: "Allow",
              kind: "allow_once",
            },
            {
              optionId: "reject",
              label: "Reject",
              kind: "reject_once",
            },
          ],
        },
      },
    },
    requestedSeq: input.requestedSeq,
    resolvedSeq: null,
    requestedAt: "2026-05-22T00:00:00Z",
    resolvedAt: null,
  };
}
