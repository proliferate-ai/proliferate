import { useMemo } from "react";
import type { TranscriptItem } from "@anyharness/sdk";
import { ProposedPlanCard } from "@/components/workspace/chat/transcript/ProposedPlanCard";
import { useProposedPlanActions } from "@/hooks/plans/use-proposed-plan-actions";
import {
  planAttachmentId,
  type PromptPlanAttachmentDescriptor,
} from "@/lib/domain/chat/prompt-content";

type ProposedPlanTranscriptItem = Extract<TranscriptItem, { kind: "proposed_plan" }>;

interface ConnectedProposedPlanItemProps {
  item: ProposedPlanTranscriptItem;
  onHandOffToNewSession?: (plan: PromptPlanAttachmentDescriptor) => void;
}

export function ConnectedProposedPlanItem({
  item,
  onHandOffToNewSession,
}: ConnectedProposedPlanItemProps) {
  const {
    approvePlan,
    rejectPlan,
    implementPlanHere,
    reviewPlan,
    configurePlanReview,
    isApprovingPlan,
    isRejectingPlan,
    isImplementingPlan,
    isStartingReview,
  } = useProposedPlanActions();
  const decision = item.decision;
  const plan = useMemo(() => proposedPlanItemToAttachment(item), [item]);

  return (
    <div className="flex justify-start relative">
      <div className="flex flex-col w-full max-w-full space-y-1 break-words">
        <ProposedPlanCard
          title={item.plan.title}
          content={item.plan.bodyMarkdown}
          isStreaming={item.status === "in_progress"}
          decisionState={decision?.decisionState ?? null}
          nativeResolutionState={decision?.nativeResolutionState ?? null}
          decisionVersion={decision?.decisionVersion ?? null}
          errorMessage={decision?.errorMessage ?? null}
          onApprove={
            decision
              ? () => approvePlan(item.plan.planId, decision.decisionVersion)
              : undefined
          }
          onReject={
            decision
              ? () => rejectPlan(item.plan.planId, decision.decisionVersion)
              : undefined
          }
          onImplementHere={() => implementPlanHere(plan)}
          onReview={() => reviewPlan(plan)}
          onConfigureReview={(anchorRect) => configurePlanReview(plan, anchorRect)}
          onHandOffToNewSession={
            onHandOffToNewSession ? () => onHandOffToNewSession(plan) : undefined
          }
          isApproving={isApprovingPlan}
          isRejecting={isRejectingPlan}
          isImplementingHere={isImplementingPlan}
          isStartingReview={isStartingReview}
        />
      </div>
    </div>
  );
}

function proposedPlanItemToAttachment(
  item: ProposedPlanTranscriptItem,
): PromptPlanAttachmentDescriptor {
  return {
    id: planAttachmentId(item.plan.planId, item.plan.snapshotHash),
    kind: "plan_reference",
    planId: item.plan.planId,
    title: item.plan.title,
    bodyMarkdown: item.plan.bodyMarkdown,
    snapshotHash: item.plan.snapshotHash,
    sourceSessionId: item.plan.sourceSessionId,
    sourceTurnId: item.plan.sourceTurnId ?? null,
    sourceItemId: item.plan.sourceItemId ?? null,
    sourceKind: item.plan.sourceKind,
    sourceToolCallId: item.plan.sourceToolCallId ?? null,
  };
}
