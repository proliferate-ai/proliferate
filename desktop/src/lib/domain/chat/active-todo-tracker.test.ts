import { describe, expect, it } from "vitest";
import { createTranscriptState, type TranscriptState } from "@anyharness/sdk";
import { deriveActiveTodoTracker } from "@/lib/domain/chat/active-todo-tracker";

describe("active todo tracker derivation", () => {
  it("returns active structured plans for non-Claude agents", () => {
    const transcript = transcriptWithItems({
      "plan-1": {
        kind: "plan",
        sourceAgentKind: "codex",
        status: "in_progress",
        startedSeq: 3,
        entries: [
          { content: "Inspect router", status: "completed" },
          { content: "Add /health endpoint", status: "in_progress" },
        ],
      },
    });

    expect(deriveActiveTodoTracker(transcript)).toEqual({
      entries: [
        { content: "Inspect router", status: "completed" },
        { content: "Add /health endpoint", status: "in_progress" },
      ],
    });
  });

  it("returns null for Claude mode-switch plans (they render in the transcript, not as a todo tracker)", () => {
    const transcript = transcriptWithItems({
      "tool-1": {
        kind: "tool_call",
        sourceAgentKind: "claude",
        nativeToolName: "ExitPlanMode",
        title: "Ready to code?",
        semanticKind: "mode_switch",
        toolCallId: "toolu_plan_1",
        approvalState: "pending",
        startedSeq: 7,
        contentParts: [
          { type: "tool_call", toolCallId: "toolu_plan_1", title: "Ready to code?", toolKind: "switch_mode" },
          { type: "tool_result_text", text: "# Plan\n\n1. Add route\n2. Add tests\n3. Return response" },
        ],
      },
    });
    transcript.pendingInteractions = [{
      requestId: "perm-1",
      kind: "permission",
      toolCallId: "toolu_plan_1",
      toolKind: "switch_mode",
      toolStatus: null,
      linkedPlanId: null,
      title: "Ready to code?",
      description: null,
      options: [],
    }];

    expect(deriveActiveTodoTracker(transcript)).toBeNull();
  });

  it("drops plans once they are no longer active", () => {
    const transcript = transcriptWithItems({
      "plan-1": {
        kind: "plan",
        sourceAgentKind: "codex",
        status: "completed",
        startedSeq: 3,
        entries: [
          { content: "Inspect router", status: "completed" },
          { content: "Add /health endpoint", status: "completed" },
        ],
      },
    });

    expect(deriveActiveTodoTracker(transcript)).toBeNull();
  });
});

function transcriptWithItems(items: Record<string, Record<string, unknown>>): TranscriptState {
  const transcript = createTranscriptState("session-1");
  transcript.turnOrder = ["turn-1"];
  transcript.turnsById["turn-1"] = {
    turnId: "turn-1",
    itemOrder: Object.keys(items),
    startedAt: "2026-04-04T00:00:00Z",
    completedAt: "2026-04-04T00:00:30Z",
    stopReason: "end_turn",
    fileBadges: [],
  };

  transcript.itemsById = Object.fromEntries(
    Object.entries(items).map(([itemId, item]) => [
      itemId,
      {
        itemId,
        turnId: "turn-1",
        status: "completed",
        title: null,
        nativeToolName: null,
        parentToolCallId: null,
        rawInput: undefined,
        rawOutput: undefined,
        messageId: null,
        timestamp: "2026-04-04T00:00:00Z",
        startedSeq: 1,
        lastUpdatedSeq: 1,
        completedSeq: 1,
        completedAt: "2026-04-04T00:00:01Z",
        contentParts: [],
        ...item,
      },
    ]),
  ) as unknown as TranscriptState["itemsById"];

  return transcript;
}
