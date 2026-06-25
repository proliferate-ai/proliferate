// @vitest-environment jsdom

import {
  createTranscriptState,
  type PendingPermissionInteraction,
  type ProposedPlanItem,
} from "@anyharness/sdk";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useActivePlanDecision } from "@/hooks/chat/derived/use-active-plan-decision";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";

afterEach(() => {
  cleanup();
  useSessionSelectionStore.setState({
    activeSessionId: null,
    activeSessionVersion: 0,
  });
  useSessionTranscriptStore.getState().clearEntries();
});

describe("useActivePlanDecision", () => {
  it("uses the active client session id as the feedback prompt target", () => {
    const clientSessionId = "client-session:codex:1000:abc123";
    const materializedSessionId = "11111111-2222-3333-4444-555555555555";
    const transcript = createTranscriptState(clientSessionId);
    const planItem = buildPendingPlanItem({
      planId: "plan-1",
      sourceSessionId: materializedSessionId,
    });
    const interaction = buildPendingPermissionInteraction({
      linkedPlanId: "plan-1",
    });

    transcript.itemsById[planItem.itemId] = planItem;
    transcript.pendingInteractions = [interaction];
    useSessionSelectionStore.setState({
      activeSessionId: clientSessionId,
      activeSessionVersion: 1,
    });
    useSessionTranscriptStore.getState().putEntry({
      sessionId: clientSessionId,
      events: [],
      transcript,
      optimisticPrompt: null,
    });

    const { result } = renderHook(() => useActivePlanDecision());

    expect(result.current?.plan).toMatchObject({
      id: "plan-1",
      sessionId: clientSessionId,
      decisionVersion: 3,
    });
  });
});

function buildPendingPermissionInteraction({
  linkedPlanId,
}: {
  linkedPlanId: string;
}): PendingPermissionInteraction {
  return {
    requestId: "permission-1",
    kind: "permission",
    toolCallId: "tool-call-1",
    toolKind: "plan_decision",
    toolStatus: null,
    linkedPlanId,
    title: "Review plan",
    description: null,
    options: [{
      optionId: "feedback",
      label: "Give feedback",
      kind: "unknown",
      presentation: {
        kind: "feedback_text_input",
        placeholder: "What should change?",
      },
    }],
  };
}

function buildPendingPlanItem({
  planId,
  sourceSessionId,
}: {
  planId: string;
  sourceSessionId: string;
}): ProposedPlanItem {
  return {
    kind: "proposed_plan",
    itemId: "plan-item-1",
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
    contentParts: [],
    timestamp: "2026-01-01T00:00:00.000Z",
    startedSeq: 1,
    lastUpdatedSeq: 3,
    completedSeq: 3,
    completedAt: "2026-01-01T00:00:03.000Z",
    plan: {
      type: "proposed_plan",
      planId,
      title: "Plan",
      bodyMarkdown: "Do the work.",
      snapshotHash: "hash-1",
      sourceSessionId,
      sourceTurnId: "turn-1",
      sourceItemId: "plan-item-1",
      sourceKind: "mode_switch",
      sourceToolCallId: "tool-call-1",
    },
    decision: {
      type: "proposed_plan_decision",
      planId,
      decisionState: "pending",
      nativeResolutionState: "none",
      decisionVersion: 3,
      errorMessage: null,
    },
  };
}
