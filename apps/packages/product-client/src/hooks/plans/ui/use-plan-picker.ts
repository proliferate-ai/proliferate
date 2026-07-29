import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlanDetailQuery, useWorkspacePlansQuery } from "@anyharness/sdk-react";
import type { ProposedPlanSummary } from "@anyharness/sdk";
import {
  formatPlanAgentKindLabel,
  formatPlanDecisionStateLabel,
} from "#product/lib/domain/plans/plan-presentation";
import {
  planAttachmentDescriptorFromDetail,
} from "@proliferate/product-domain/chats/composer/prompt-plan-attachments";
import { useToastStore } from "#product/stores/toast/toast-store";
import { useAddPlanDraftAttachment } from "#product/hooks/plans/workflows/use-add-plan-draft-attachment";

const EMPTY_PLANS: ProposedPlanSummary[] = [];

// Owns the plan picker popover state and attach flow. Does not own composer draft rendering.
export function usePlanPicker(options: {
  workspaceUiKey: string | null;
  sdkWorkspaceId: string | null;
  open: boolean;
  onAttached?: () => void;
}) {
  const { workspaceUiKey, sdkWorkspaceId, open, onAttached } = options;
  const showErrorToast = useToastStore((state) => state.showError);
  const [search, setSearch] = useState("");
  const [attachingPlanId, setAttachingPlanId] = useState<string | null>(null);
  const { addPlan } = useAddPlanDraftAttachment(workspaceUiKey);
  const plansQuery = useWorkspacePlansQuery({
    workspaceId: sdkWorkspaceId,
    enabled: open && !!sdkWorkspaceId,
  });
  const detailQuery = usePlanDetailQuery(attachingPlanId, {
    workspaceId: sdkWorkspaceId,
    enabled: open && !!attachingPlanId && !!sdkWorkspaceId,
  });

  const plans: ProposedPlanSummary[] = plansQuery.data ?? EMPTY_PLANS;
  const filteredPlans = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return plans;
    }
    // List summaries intentionally omit bodyMarkdown; v1 picker search is
    // title/metadata-only unless the runtime adds a snippet/search endpoint.
    return plans.filter((plan) => [
      plan.title,
      formatPlanAgentKindLabel(plan.sourceAgentKind),
      plan.sourceKind,
      formatPlanDecisionStateLabel(plan.decisionState),
    ].some((value) => value.toLowerCase().includes(query)));
  }, [plans, search]);

  useEffect(() => {
    if (!attachingPlanId || !detailQuery.data) {
      return;
    }
    if (!addPlan(planAttachmentDescriptorFromDetail(detailQuery.data))) {
      setAttachingPlanId(null);
      return;
    }
    setAttachingPlanId(null);
    onAttached?.();
  }, [addPlan, attachingPlanId, detailQuery.data, onAttached]);

  useEffect(() => {
    if (!attachingPlanId || !detailQuery.isError) {
      return;
    }
    const failedPlanId = attachingPlanId;
    // Names the plan the user clicked, from the row they clicked it on: the
    // picker closes on attach, so the toast may be all that is left on screen.
    const failedPlanTitle = plans.find((plan) => plan.id === failedPlanId)?.title;
    setAttachingPlanId(null);
    showErrorToast({
      headline: "Plan not attached",
      consequence: failedPlanTitle
        ? `"${failedPlanTitle}" is not on your message. Your draft is unchanged.`
        : "It is not on your message. Your draft is unchanged.",
      cause: detailQuery.error instanceof Error
        ? detailQuery.error.message
        : "Plan is not available.",
      retry: () => setAttachingPlanId(failedPlanId),
    });
  }, [attachingPlanId, detailQuery.error, detailQuery.isError, plans, showErrorToast]);

  const attachPlan = useCallback((planId: string) => {
    setAttachingPlanId(planId);
  }, []);

  return {
    search,
    setSearch,
    plans: filteredPlans,
    isLoading: plansQuery.isLoading,
    isError: plansQuery.isError,
    attachingPlanId,
    attachPlan,
  };
}
