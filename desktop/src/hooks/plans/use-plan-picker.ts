import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlanDetailQuery, useWorkspacePlansQuery } from "@anyharness/sdk-react";
import type { ProposedPlanSummary } from "@anyharness/sdk";
import {
  formatPlanAgentKindLabel,
  formatPlanDecisionStateLabel,
} from "@/config/plans";
import {
  planAttachmentDescriptorFromDetail,
} from "@/lib/domain/chat/prompt-content";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useAddPlanDraftAttachment } from "@/hooks/plans/use-add-plan-draft-attachment";

const EMPTY_PLANS: ProposedPlanSummary[] = [];

export function usePlanPicker(options: {
  draftWorkspaceId: string | null;
  open: boolean;
  onAttached?: () => void;
}) {
  const { draftWorkspaceId, open, onAttached } = options;
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const workspaceId = draftWorkspaceId ?? selectedWorkspaceId;
  const showToast = useToastStore((state) => state.show);
  const [search, setSearch] = useState("");
  const [attachingPlanId, setAttachingPlanId] = useState<string | null>(null);
  const { addPlan } = useAddPlanDraftAttachment(draftWorkspaceId);
  const plansQuery = useWorkspacePlansQuery({
    workspaceId,
    enabled: open && !!workspaceId,
  });
  const detailQuery = usePlanDetailQuery(attachingPlanId, {
    workspaceId,
    enabled: open && !!attachingPlanId && !!workspaceId,
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
    setAttachingPlanId(null);
    const message = detailQuery.error instanceof Error
      ? detailQuery.error.message
      : "Plan is not available.";
    showToast(`Failed to attach plan: ${message}`);
  }, [attachingPlanId, detailQuery.error, detailQuery.isError, showToast]);

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
