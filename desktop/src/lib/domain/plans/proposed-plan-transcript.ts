import type {
  ProposedPlanDecisionContentPart,
  ProposedPlanDetail,
  TranscriptState,
} from "@anyharness/sdk";

export function patchProposedPlanDecisionInTranscript(
  transcript: TranscriptState,
  plan: ProposedPlanDetail,
): TranscriptState {
  const decision = planToDecisionContentPart(plan);
  let changed = false;
  const nextItemsById = Object.fromEntries(
    Object.entries(transcript.itemsById).map(([itemId, item]) => {
      if (item.kind !== "proposed_plan" || item.plan.planId !== plan.id) {
        return [itemId, item];
      }

      if (
        item.decision
        && item.decision.decisionVersion > decision.decisionVersion
      ) {
        return [itemId, item];
      }

      if (
        item.decision
        && item.decision.decisionVersion === decision.decisionVersion
        && item.decision.decisionState === decision.decisionState
        && item.decision.nativeResolutionState === decision.nativeResolutionState
        && (item.decision.errorMessage ?? null) === null
      ) {
        return [itemId, item];
      }

      changed = true;
      return [itemId, {
        ...item,
        decision,
        contentParts: [
          ...item.contentParts.filter((part) => (
            part.type !== "proposed_plan_decision"
            || part.planId !== plan.id
            || part.decisionVersion > decision.decisionVersion
          )),
          decision,
        ],
      }];
    }),
  );

  if (!changed) {
    return transcript;
  }

  return {
    ...transcript,
    itemsById: nextItemsById,
  };
}

function planToDecisionContentPart(plan: ProposedPlanDetail): ProposedPlanDecisionContentPart {
  return {
    type: "proposed_plan_decision",
    planId: plan.id,
    decisionState: plan.decisionState,
    decisionVersion: plan.decisionVersion,
    nativeResolutionState: plan.nativeResolutionState,
    errorMessage: null,
  };
}
