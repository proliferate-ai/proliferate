import { useCallback, useMemo } from "react";
import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import { usePlanDetailsQueries } from "@anyharness/sdk-react";
import {
  isResolvedPlanAttachment,
  planAttachmentDescriptorFromDetail,
  planAttachmentPlaceholderFromPointer,
  planReferenceContentPartFromDescriptor,
  type PromptPlanAttachmentDescriptor,
  type PromptPlanAttachmentPointer,
} from "@/lib/domain/chat/prompt-content";
import { dedupePlanReferenceBlocks } from "@/lib/domain/chat/prompt-input";
import { useAddPlanDraftAttachment } from "@/hooks/plans/use-add-plan-draft-attachment";
import { useChatPlanAttachmentStore } from "@/stores/chat/chat-plan-attachment-store";

const EMPTY_PLANS: PromptPlanAttachmentPointer[] = [];

export function usePlanDraftAttachments({
  workspaceUiKey,
  sdkWorkspaceId,
}: {
  workspaceUiKey: string | null | undefined;
  sdkWorkspaceId: string | null | undefined;
}) {
  const pointers = useChatPlanAttachmentStore((state) =>
    workspaceUiKey ? state.attachmentsByWorkspaceId[workspaceUiKey] ?? EMPTY_PLANS : EMPTY_PLANS
  );
  const removePlanAttachment = useChatPlanAttachmentStore((state) => state.removePlanAttachment);
  const clearPlanAttachments = useChatPlanAttachmentStore((state) => state.clearPlanAttachments);
  const { addPlan } = useAddPlanDraftAttachment(workspaceUiKey);
  const detailQueries = usePlanDetailsQueries(pointers.map((pointer) => pointer.planId), {
    workspaceId: sdkWorkspaceId,
    enabled: !!sdkWorkspaceId,
  });

  const attachments = useMemo<PromptPlanAttachmentDescriptor[]>(() => {
    return pointers.map((pointer, index) => {
      const query = detailQueries[index];
      const detail = query?.data;
      if (detail && detail.snapshotHash === pointer.snapshotHash) {
        return planAttachmentDescriptorFromDetail(detail);
      }
      if (detail && detail.snapshotHash !== pointer.snapshotHash) {
        return planAttachmentPlaceholderFromPointer(pointer, "stale");
      }
      if (query?.isError) {
        const message = query.error instanceof Error
          ? query.error.message
          : "The attached plan could not be loaded.";
        return planAttachmentPlaceholderFromPointer(pointer, "error", message);
      }
      return planAttachmentPlaceholderFromPointer(pointer, "loading");
    });
  }, [detailQueries, pointers]);

  const resolvedAttachments = useMemo(
    () => attachments.filter(isResolvedPlanAttachment),
    [attachments],
  );

  const removePlan = useCallback((id: string) => {
    if (!workspaceUiKey) {
      return;
    }
    removePlanAttachment(workspaceUiKey, id);
  }, [removePlanAttachment, workspaceUiKey]);

  const clearPlans = useCallback(() => {
    if (!workspaceUiKey) {
      return;
    }
    clearPlanAttachments(workspaceUiKey);
  }, [clearPlanAttachments, workspaceUiKey]);

  const blocks = useMemo<PromptInputBlock[]>(
    () => dedupePlanReferenceBlocks(resolvedAttachments.map((plan) => ({
      type: "plan_reference" as const,
      planId: plan.planId,
      snapshotHash: plan.snapshotHash,
    }))),
    [resolvedAttachments],
  );

  const contentParts = useMemo<ContentPart[]>(
    () => resolvedAttachments.map(planReferenceContentPartFromDescriptor),
    [resolvedAttachments],
  );

  return {
    attachments,
    addPlan,
    removePlan,
    clearPlans,
    blocks,
    contentParts,
    hasPlans: pointers.length > 0,
    hasUnresolvedPlans: resolvedAttachments.length !== pointers.length,
  };
}
