import { useCallback } from "react";
import { PLAN_ATTACHMENT_LIMIT } from "@/config/plans";
import {
  planAttachmentPointerFromDescriptor,
  type PromptPlanAttachmentDescriptor,
  type PromptPlanAttachmentPointer,
} from "@/lib/domain/chat/prompt-content";
import { useChatPlanAttachmentStore } from "@/stores/chat/chat-plan-attachment-store";
import { useToastStore } from "@/stores/toast/toast-store";

const EMPTY_PLANS: PromptPlanAttachmentPointer[] = [];

export function useAddPlanDraftAttachment(workspaceId: string | null | undefined) {
  const addPlanAttachment = useChatPlanAttachmentStore((state) => state.addPlanAttachment);
  const showToast = useToastStore((state) => state.show);

  const addPlan = useCallback((plan: PromptPlanAttachmentDescriptor) => {
    if (!workspaceId) {
      return false;
    }
    const pointer = planAttachmentPointerFromDescriptor(plan);
    const current =
      useChatPlanAttachmentStore.getState().attachmentsByWorkspaceId[workspaceId] ?? EMPTY_PLANS;
    const alreadyAttached = current.some((candidate) => candidate.id === pointer.id);
    if (!alreadyAttached && current.length >= PLAN_ATTACHMENT_LIMIT) {
      showToast(`You can attach up to ${PLAN_ATTACHMENT_LIMIT} plans.`);
      return false;
    }
    addPlanAttachment(workspaceId, pointer);
    return true;
  }, [addPlanAttachment, showToast, workspaceId]);

  return { addPlan };
}
