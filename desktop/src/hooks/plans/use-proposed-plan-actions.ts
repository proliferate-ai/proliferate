import { useCallback, useRef, useState } from "react";
import { AnyHarnessError } from "@anyharness/sdk";
import {
  useApprovePlanMutation,
  useRejectPlanMutation,
} from "@anyharness/sdk-react";
import { useReviewActions } from "@/hooks/reviews/use-review-actions";
import { PLAN_ATTACHMENT_LIMIT } from "@/config/plans";
import { PLAN_IMPLEMENT_HERE_PROMPT } from "@/config/plan-prompts";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { resolveChatDraftWorkspaceId } from "@/lib/domain/chat/chat-input";
import {
  EMPTY_CHAT_DRAFT,
  isChatDraftEmpty,
} from "@/lib/domain/chat/file-mentions";
import {
  planAttachmentPointerFromDescriptor,
  type PromptPlanAttachmentDescriptor,
} from "@/lib/domain/chat/prompt-content";
import { resolvePlanImplementationModeSwitch } from "@/lib/domain/plans/implementation-mode";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useChatPlanAttachmentStore } from "@/stores/chat/chat-plan-attachment-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";

export function useProposedPlanActions() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useLogicalWorkspaceStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const appendDraftText = useChatInputStore((state) => state.appendDraftText);
  const addPlanAttachment = useChatPlanAttachmentStore((state) => state.addPlanAttachment);
  const showToast = useToastStore((state) => state.show);
  const [isPreparingPlanReference, setIsPreparingPlanReference] = useState(false);
  const isPreparingPlanReferenceRef = useRef(false);
  const approveMutation = useApprovePlanMutation({ workspaceId: selectedWorkspaceId });
  const rejectMutation = useRejectPlanMutation({ workspaceId: selectedWorkspaceId });
  const reviewActions = useReviewActions();
  const { setActiveSessionConfigOption } = useSessionActions();
  const approvePlanMutation = approveMutation.mutateAsync;
  const rejectPlanMutation = rejectMutation.mutateAsync;

  const approvePlan = useCallback((planId: string, expectedDecisionVersion: number) => {
    void approvePlanMutation({ planId, expectedDecisionVersion }).catch((error) => {
      if (isPlanDecisionVersionConflict(error)) {
        showToast("Plan decision was updated. Refreshing plan state.");
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to approve plan: ${message}`);
    });
  }, [approvePlanMutation, showToast]);

  const rejectPlan = useCallback((planId: string, expectedDecisionVersion: number) => {
    void rejectPlanMutation({ planId, expectedDecisionVersion }).catch((error) => {
      if (isPlanDecisionVersionConflict(error)) {
        showToast("Plan decision was updated. Refreshing plan state.");
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to reject plan: ${message}`);
    });
  }, [rejectPlanMutation, showToast]);

  const implementPlanHere = useCallback((plan: PromptPlanAttachmentDescriptor) => {
    if (isPreparingPlanReferenceRef.current) {
      return;
    }
    isPreparingPlanReferenceRef.current = true;
    void (async () => {
      setIsPreparingPlanReference(true);
      const harnessState = useHarnessStore.getState();
      const planSessionSlot = harnessState.sessionSlots[plan.sourceSessionId] ?? null;
      if (!planSessionSlot) {
        showToast("Plan session is not available.");
        return;
      }
      if (harnessState.activeSessionId !== plan.sourceSessionId) {
        showToast("Select the plan's session before carrying it out.");
        return;
      }
      const draftWorkspaceId = resolveChatDraftWorkspaceId(
        selectedLogicalWorkspaceId,
        planSessionSlot.workspaceId ?? selectedWorkspaceId,
      );
      if (!draftWorkspaceId) {
        showToast("Select a workspace before implementing a plan.");
        return;
      }

      const modeSwitch = resolvePlanImplementationModeSwitch({
        collaborationMode:
          planSessionSlot.liveConfig?.normalizedControls.collaborationMode ?? null,
        mode: planSessionSlot.liveConfig?.normalizedControls.mode ?? null,
      });
      if (modeSwitch) {
        await setActiveSessionConfigOption(modeSwitch.rawConfigId, modeSwitch.value, {
          persistDefaultPreference: false,
        });
      }

      const currentDraft =
        useChatInputStore.getState().draftByWorkspaceId[draftWorkspaceId] ?? EMPTY_CHAT_DRAFT;
      const pointer = planAttachmentPointerFromDescriptor(plan);
      const currentPlans =
        useChatPlanAttachmentStore.getState().attachmentsByWorkspaceId[draftWorkspaceId] ?? [];
      const alreadyAttached = currentPlans.some((candidate) => candidate.id === pointer.id);
      if (!alreadyAttached && currentPlans.length >= PLAN_ATTACHMENT_LIMIT) {
        showToast(`You can attach up to ${PLAN_ATTACHMENT_LIMIT} plans.`);
        return;
      }
      addPlanAttachment(draftWorkspaceId, pointer);
      appendDraftText(
        draftWorkspaceId,
        isChatDraftEmpty(currentDraft)
          ? PLAN_IMPLEMENT_HERE_PROMPT
          : `\n\n${PLAN_IMPLEMENT_HERE_PROMPT}`,
      );
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to prepare plan reference: ${message}`);
    }).finally(() => {
      isPreparingPlanReferenceRef.current = false;
      setIsPreparingPlanReference(false);
    });
  }, [
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    addPlanAttachment,
    appendDraftText,
    setActiveSessionConfigOption,
    showToast,
  ]);

  return {
    approvePlan,
    rejectPlan,
    implementPlanHere,
    reviewPlan: reviewActions.startPlanReview,
    isApprovingPlan: approveMutation.isPending,
    isRejectingPlan: rejectMutation.isPending,
    isPreparingPlanReference,
  };
}

function isPlanDecisionVersionConflict(error: unknown): boolean {
  return error instanceof AnyHarnessError
    && error.problem.status === 409
    && error.problem.code === "PLAN_DECISION_VERSION_CONFLICT";
}
