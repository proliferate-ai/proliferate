import { describe, expect, it } from "vitest";

import type { TranscriptState } from "../types/reducer.js";
import { createTranscriptState } from "./transcript.js";
import { deriveCanonicalPlan } from "./canonical-plan.js";

describe("canonical plan derivation", () => {
  it("derives canonical plans from structured plan items for non-Claude agents", () => {
    const transcript = transcriptWithItems({
      "plan-1": {
        kind: "plan",
        sourceAgentKind: "codex",
        startedSeq: 3,
        entries: [
          { content: "Inspect router", status: "completed" },
          { content: "Add /health", status: "in_progress" },
        ],
      },
    });

    expect(deriveCanonicalPlan(transcript)).toEqual({
      title: "Plan",
      sourceKind: "structured_plan",
      itemId: "plan-1",
      turnId: "turn-1",
      entries: [
        { content: "Inspect router", status: "completed" },
        { content: "Add /health", status: "in_progress" },
      ],
      body: null,
      isActive: false,
    });
  });

  it("ignores Claude TodoWrite-derived plan items", () => {
    const transcript = transcriptWithItems({
      "plan-1": {
        kind: "plan",
        sourceAgentKind: "claude",
        startedSeq: 2,
        entries: [{ content: "Internal todo", status: "pending" }],
      },
    });

    expect(deriveCanonicalPlan(transcript)).toBeNull();
  });

  it("derives canonical plans from Claude ExitPlanMode tool calls", () => {
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
    transcript.pendingApproval = {
      requestId: "perm-1",
      toolCallId: "toolu_plan_1",
      title: "Ready to code?",
      options: {},
    };

    expect(deriveCanonicalPlan(transcript)).toEqual({
      title: "Plan",
      sourceKind: "mode_switch",
      itemId: "tool-1",
      turnId: "turn-1",
      entries: [],
      body: "# Plan\n\n1. Add route\n2. Add tests\n3. Return response",
      isActive: true,
    });
  });

  it("does not treat generic prose or empty mode switches as canonical plans", () => {
    const transcript = transcriptWithItems({
      "assistant-1": {
        kind: "assistant_prose",
        sourceAgentKind: "gemini",
        startedSeq: 2,
        text: "Plan:\n1. Add route\n2. Add tests\n3. Deploy",
      },
      "tool-1": {
        kind: "tool_call",
        sourceAgentKind: "claude",
        nativeToolName: "ExitPlanMode",
        title: "Ready to code?",
        semanticKind: "mode_switch",
        toolCallId: "toolu_plan_empty",
        approvalState: "none",
        startedSeq: 3,
        contentParts: [
          { type: "tool_call", toolCallId: "toolu_plan_empty", title: "Ready to code?", toolKind: "switch_mode" },
        ],
      },
    });

    expect(deriveCanonicalPlan(transcript)).toBeNull();
  });

  it("returns the latest canonical plan across mixed planning artifacts", () => {
    const transcript = transcriptWithItems({
      "plan-1": {
        kind: "plan",
        sourceAgentKind: "codex",
        startedSeq: 2,
        entries: [{ content: "Old plan", status: "completed" }],
      },
      "tool-1": {
        kind: "tool_call",
        sourceAgentKind: "claude",
        nativeToolName: "ExitPlanMode",
        title: "Ready to code?",
        semanticKind: "mode_switch",
        toolCallId: "toolu_plan_2",
        approvalState: "approved",
        startedSeq: 8,
        contentParts: [
          { type: "tool_call", toolCallId: "toolu_plan_2", title: "Ready to code?", toolKind: "switch_mode" },
          { type: "tool_result_text", text: "## Final Plan\n\n1. Ship it" },
        ],
      },
    });

    const plan = deriveCanonicalPlan(transcript);
    expect(plan?.sourceKind).toBe("mode_switch");
    expect(plan?.body).toBe("## Final Plan\n\n1. Ship it");
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
