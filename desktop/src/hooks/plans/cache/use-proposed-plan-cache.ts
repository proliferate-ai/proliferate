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
import { patchProposedPlanDecisionInTranscript } from "@/lib/domain/plans/proposed-plan-transcript";
import {
  getSessionRecord,
  patchSessionRecord,
} from "@/stores/sessions/session-records";

interface ProposedPlanCacheOptions {
  runtimeUrl: string;
  selectedWorkspaceId: string | null;
}

// Owns cache writes needed by proposed-plan card actions, including transcript projections.
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

  const applyPlanDecisionToCache = useCallback((plan: ProposedPlanDetail) => {
    patchPlanDecisionQueries(plan);
    patchCachedPlanTranscripts(plan);
  }, [patchPlanDecisionQueries]);

  return {
    applyPlanDecisionToCache,
  };
}

function patchCachedPlanTranscripts(plan: ProposedPlanDetail): void {
  const candidateSessionIds = new Set([plan.sessionId, plan.sourceSessionId]);
  candidateSessionIds.forEach((sessionId) => {
    const slot = getSessionRecord(sessionId);
    if (!slot) {
      return;
    }

    const transcript = patchProposedPlanDecisionInTranscript(slot.transcript, plan);
    if (transcript === slot.transcript) {
      return;
    }

    patchSessionRecord(sessionId, {
      transcript,
    });
  });
}
