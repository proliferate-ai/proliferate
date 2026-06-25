import { useMemo } from "react";
import type {
  PendingPermissionInteraction,
  ProposedPlanDecisionContentPart,
  ProposedPlanContentPart,
  TranscriptItem,
  TranscriptState,
} from "@anyharness/sdk";
import { useShallow } from "zustand/react/shallow";
import { parsePermissionOptionActions, type PermissionOptionAction } from "@/lib/domain/chat/composer/chat-input-helpers";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { useActiveSessionId } from "./use-active-session-identity";

export interface ActivePlanDecision {
  pendingApproval: PendingPermissionInteraction;
  actions: PermissionOptionAction[];
  plan: {
    id: string;
    sourceSessionId: string;
    decisionVersion: number;
  };
}

export function useActivePlanDecision(): ActivePlanDecision | null {
  const activeSessionId = useActiveSessionId();
  const pendingApproval = useSessionTranscriptStore(useShallow((state) => {
    const transcript = activeSessionId
      ? state.entriesById[activeSessionId]?.transcript ?? null
      : null;
    return transcript ? selectPendingPlanDecision(transcript) : null;
  }));
  const actions = useMemo(
    () => parsePermissionOptionActions(pendingApproval?.interaction.options),
    [pendingApproval?.interaction.options],
  );

  return useMemo(() => (
    pendingApproval ? {
      pendingApproval: pendingApproval.interaction,
      actions,
      plan: {
        id: pendingApproval.plan.planId,
        sourceSessionId: pendingApproval.plan.sourceSessionId,
        decisionVersion: pendingApproval.decision?.decisionVersion ?? 1,
      },
    } : null
  ), [actions, pendingApproval]);
}

interface PendingPlanDecisionSelection {
  interaction: PendingPermissionInteraction;
  plan: ProposedPlanContentPart;
  decision: ProposedPlanDecisionContentPart | null;
}

type ProposedPlanTranscriptItem = Extract<TranscriptItem, { kind: "proposed_plan" }>;

function selectPendingPlanDecision(
  transcript: TranscriptState,
): PendingPlanDecisionSelection | null {
  const pendingPlans = Object.values(transcript.itemsById).filter((
    item,
  ): item is ProposedPlanTranscriptItem =>
    item.kind === "proposed_plan"
    && (item.decision?.decisionState ?? "pending") === "pending"
  );
  const pendingPlanByToolCallId = new Map<string, (typeof pendingPlans)[number]>();
  const pendingPlanById = new Map<string, (typeof pendingPlans)[number]>();
  for (const item of pendingPlans) {
    pendingPlanById.set(item.plan.planId, item);
    if (item.plan.sourceToolCallId) {
      pendingPlanByToolCallId.set(item.plan.sourceToolCallId, item);
    }
  }

  for (const interaction of transcript.pendingInteractions) {
    if (interaction.kind === "permission") {
      const item = interaction.linkedPlanId
        ? pendingPlanById.get(interaction.linkedPlanId) ?? null
        : interaction.toolCallId
          ? pendingPlanByToolCallId.get(interaction.toolCallId) ?? null
          : null;
      if (item) {
        return {
          interaction,
          plan: item.plan,
          decision: item.decision,
        };
      }
    }
  }
  return null;
}
