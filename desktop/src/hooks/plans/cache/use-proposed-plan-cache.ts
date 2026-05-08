import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ProposedPlanDetail,
  ProposedPlanSummary,
} from "@anyharness/sdk";
import {
  anyHarnessPlanKey,
  anyHarnessPlansKey,
} from "@anyharness/sdk-react";

interface ProposedPlanCacheOptions {
  runtimeUrl: string;
  selectedWorkspaceId: string | null;
}

// Owns query-cache writes needed by proposed-plan card actions.
export function useProposedPlanCache({
  runtimeUrl,
  selectedWorkspaceId,
}: ProposedPlanCacheOptions) {
  const queryClient = useQueryClient();

  const patchPlanDecisionQueries = useCallback((plan: ProposedPlanDetail) => {
    queryClient.setQueryData(
      anyHarnessPlanKey(runtimeUrl, selectedWorkspaceId, plan.id),
      plan,
    );
    queryClient.setQueryData<ProposedPlanSummary[]>(
      anyHarnessPlansKey(runtimeUrl, selectedWorkspaceId),
      (plans) => plans?.map((cachedPlan) => (
        cachedPlan.id === plan.id ? { ...cachedPlan, ...plan } : cachedPlan
      )),
    );
  }, [queryClient, runtimeUrl, selectedWorkspaceId]);

  return {
    patchPlanDecisionQueries,
  };
}
