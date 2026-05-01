import { describe, expect, it } from "vitest";
import type { ProposedPlanDetail, TranscriptState } from "@anyharness/sdk";
import { patchProposedPlanDecisionInTranscript } from "./proposed-plan-transcript";

describe("patchProposedPlanDecisionInTranscript", () => {
  it("updates the matching proposed plan decision", () => {
    const transcript = transcriptWithPlan();

    const next = patchProposedPlanDecisionInTranscript(
      transcript,
      plan({ decisionState: "approved", decisionVersion: 2 }),
    );

    const item = next.itemsById["item-1"];
    expect(item?.kind).toBe("proposed_plan");
    if (item?.kind !== "proposed_plan") {
      throw new Error("expected proposed plan item");
    }
    expect(item.decision).toMatchObject({
      type: "proposed_plan_decision",
      planId: "plan-1",
      decisionState: "approved",
      decisionVersion: 2,
      nativeResolutionState: "finalized",
    });
    expect(item.contentParts).toContainEqual(item.decision);
    expect(next).not.toBe(transcript);
    expect(next.itemsById["item-2"]).toBe(transcript.itemsById["item-2"]);
  });

  it("does not replace a newer local decision", () => {
    const transcript = patchProposedPlanDecisionInTranscript(
      transcriptWithPlan(),
      plan({ decisionState: "approved", decisionVersion: 3 }),
    );

    const next = patchProposedPlanDecisionInTranscript(
      transcript,
      plan({ decisionState: "rejected", decisionVersion: 2 }),
    );

    expect(next).toBe(transcript);
  });

  it("returns the original transcript when the plan is not present", () => {
    const transcript = transcriptWithPlan();

    const next = patchProposedPlanDecisionInTranscript(
      transcript,
      plan({ id: "other-plan" }),
    );

    expect(next).toBe(transcript);
  });
});

function transcriptWithPlan(): TranscriptState {
  return {
    sessionMeta: {
      sessionId: "session-1",
      title: null,
      updatedAt: null,
      nativeSessionId: null,
      sourceAgentKind: "codex",
    },
    turnOrder: ["turn-1"],
    turnsById: {
      "turn-1": {
        turnId: "turn-1",
        itemOrder: ["item-1", "item-2"],
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: null,
        stopReason: null,
        fileBadges: [],
      },
    },
    itemsById: {
      "item-1": {
        kind: "proposed_plan",
        itemId: "item-1",
        turnId: "turn-1",
        status: "completed",
        sourceAgentKind: "codex",
        isTransient: false,
        messageId: null,
        title: "Plan",
        nativeToolName: null,
        parentToolCallId: null,
        rawInput: null,
        rawOutput: null,
        contentParts: [
          {
            type: "proposed_plan",
            planId: "plan-1",
            title: "Plan",
            bodyMarkdown: "Do work.",
            snapshotHash: "hash-1",
            sourceSessionId: "session-1",
            sourceTurnId: "turn-1",
            sourceItemId: "item-1",
            sourceKind: "proposed_plan",
            sourceToolCallId: null,
          },
          {
            type: "proposed_plan_decision",
            planId: "plan-1",
            decisionState: "pending",
            decisionVersion: 1,
            nativeResolutionState: "none",
            errorMessage: null,
          },
        ],
        timestamp: "2026-01-01T00:00:00Z",
        startedSeq: 1,
        lastUpdatedSeq: 1,
        completedAt: "2026-01-01T00:00:00Z",
        completedSeq: 1,
        plan: {
          type: "proposed_plan",
          planId: "plan-1",
          title: "Plan",
          bodyMarkdown: "Do work.",
          snapshotHash: "hash-1",
          sourceSessionId: "session-1",
          sourceTurnId: "turn-1",
          sourceItemId: "item-1",
          sourceKind: "proposed_plan",
          sourceToolCallId: null,
        },
        decision: {
          type: "proposed_plan_decision",
          planId: "plan-1",
          decisionState: "pending",
          decisionVersion: 1,
          nativeResolutionState: "none",
          errorMessage: null,
        },
      },
      "item-2": {
        kind: "assistant_prose",
        itemId: "item-2",
        turnId: "turn-1",
        status: "completed",
        sourceAgentKind: "codex",
        isTransient: false,
        messageId: null,
        title: null,
        nativeToolName: null,
        parentToolCallId: null,
        rawInput: null,
        rawOutput: null,
        contentParts: [{ type: "text", text: "Done." }],
        timestamp: "2026-01-01T00:00:00Z",
        startedSeq: 2,
        lastUpdatedSeq: 2,
        completedAt: "2026-01-01T00:00:00Z",
        completedSeq: 2,
        text: "Done.",
        isStreaming: false,
      },
    },
    openAssistantItemId: null,
    openThoughtItemId: null,
    pendingInteractions: [],
    availableCommands: [],
    liveConfig: null,
    currentModeId: null,
    usageState: null,
    unknownEvents: [],
    isStreaming: false,
    lastSeq: 2,
    pendingPrompts: [],
    linkCompletionsByCompletionId: {},
    latestLinkCompletionBySessionLinkId: {},
  };
}

function plan(overrides: Partial<ProposedPlanDetail> = {}): ProposedPlanDetail {
  return {
    id: "plan-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    itemId: "item-1",
    title: "Plan",
    snapshotHash: "hash-1",
    decisionState: "approved",
    nativeResolutionState: "finalized",
    decisionVersion: 2,
    sourceAgentKind: "codex",
    sourceSessionId: "session-1",
    sourceKind: "proposed_plan",
    sourceTurnId: "turn-1",
    sourceItemId: "item-1",
    sourceToolCallId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    bodyMarkdown: "Do work.",
    ...overrides,
  };
}
