import { useCallback, useRef, useState } from "react";
import { type ProposedPlanDetail } from "@anyharness/sdk";
import {
  useApprovePlanMutation,
  useFetchPlanMutation,
  useRejectPlanMutation,
} from "@anyharness/sdk-react";
import { useWorkspaceSetupStatusCache } from "#product/hooks/access/anyharness/workspaces/use-workspace-setup-status-cache";
import { useChatAvailabilityState } from "#product/hooks/chat/derived/use-chat-availability-state";
import { useGitPromptSnapshotEffects } from "#product/hooks/workspaces/workflows/use-git-prompt-snapshot-effects";
import { useProposedPlanCache } from "#product/hooks/plans/cache/use-proposed-plan-cache";
import { useSessionConfigActions } from "#product/hooks/sessions/workflows/use-session-config-actions";
import { useSessionPromptActions } from "#product/hooks/sessions/workflows/use-session-prompt-actions";
import { type PromptPlanAttachmentDescriptor } from "#product/domain/chats/composer/prompt-plan-attachments";
import { type PlanImplementationHarnessState } from "#product/lib/domain/plans/implementation-target";
import { useProductTelemetry } from "#product/hooks/telemetry/facade/use-product-telemetry";
import {
  failLatencyFlow as failPromptLatencyFlow,
  logLatency,
  startLatencyFlow as startPromptLatencyFlow,
} from "#product/lib/infra/measurement/measurement-port";
import { completeChatPromptSubmitSideEffects } from "#product/lib/workflows/chat/complete-chat-prompt-submit-side-effects";
import {
  claimPlanImplementationRun,
  executePlanImplementation,
} from "#product/lib/workflows/plans/execute-plan-implementation";
import { runPlanDecisionMutation } from "#product/lib/workflows/plans/run-plan-decision-mutation";
import { getSessionRecords } from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useToastStore } from "#product/stores/toast/toast-store";

// Compatibility facade for proposed-plan card actions.
export function useProposedPlanActions() {
  const decisionActions = useProposedPlanDecisionActions();
  const implementationActions = usePlanImplementationActions();

  return {
    approvePlan: decisionActions.approvePlan,
    rejectPlan: decisionActions.rejectPlan,
    implementPlanHere: implementationActions.implementPlanHere,
    isApprovingPlan: decisionActions.isApprovingPlan,
    isRejectingPlan: decisionActions.isRejectingPlan,
    isImplementingPlan: implementationActions.isImplementingPlan,
  };
}

// Owns approve/reject actions and decision-conflict refresh behavior.
function useProposedPlanDecisionActions() {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const showToast = useToastStore((state) => state.show);
  const showErrorToast = useToastStore((state) => state.showError);
  const approveMutation = useApprovePlanMutation({ workspaceId: selectedWorkspaceId });
  const rejectMutation = useRejectPlanMutation({ workspaceId: selectedWorkspaceId });
  const fetchPlanMutation = useFetchPlanMutation({ workspaceId: selectedWorkspaceId });
  const approvePlanMutation = approveMutation.mutateAsync;
  const rejectPlanMutation = rejectMutation.mutateAsync;
  const {
    applyPlanDecisionToCache,
  } = useProposedPlanCache({
    selectedWorkspaceId,
  });

  const applyPlanDecision = useCallback((plan: ProposedPlanDetail) => {
    applyPlanDecisionToCache(plan);
  }, [applyPlanDecisionToCache]);

  const refreshAndApplyPlanDecision = useCallback(async (planId: string) => {
    const plan = await fetchPlanMutation.mutateAsync({
      workspaceId: selectedWorkspaceId,
      planId,
    });
    applyPlanDecision(plan);
    logLatency("plan.decision.refreshed", {
      planId,
      workspaceId: selectedWorkspaceId,
      sessionId: plan.sessionId,
      decisionState: plan.decisionState,
      decisionVersion: plan.decisionVersion,
    });
    return plan;
  }, [applyPlanDecision, fetchPlanMutation, selectedWorkspaceId]);

  const approvePlan = useCallback(function approvePlan(
    planId: string,
    expectedDecisionVersion: number,
  ) {
    void runPlanDecisionMutation({
      planId,
      expectedDecisionVersion,
      mutate: approvePlanMutation,
      applyPlanDecision,
      refreshAndApplyPlanDecision,
      showToast,
      showErrorToast,
      failure: {
        headline: "Plan not approved",
        consequence: "It is still awaiting a decision.",
      },
      retry: () => approvePlan(planId, expectedDecisionVersion),
    });
  }, [
    applyPlanDecision,
    approvePlanMutation,
    refreshAndApplyPlanDecision,
    showErrorToast,
    showToast,
  ]);

  const rejectPlan = useCallback(function rejectPlan(
    planId: string,
    expectedDecisionVersion: number,
  ) {
    void runPlanDecisionMutation({
      planId,
      expectedDecisionVersion,
      mutate: rejectPlanMutation,
      applyPlanDecision,
      refreshAndApplyPlanDecision,
      showToast,
      showErrorToast,
      failure: {
        headline: "Plan not rejected",
        consequence: "It is still awaiting a decision.",
      },
      retry: () => rejectPlan(planId, expectedDecisionVersion),
    });
  }, [
    applyPlanDecision,
    refreshAndApplyPlanDecision,
    rejectPlanMutation,
    showErrorToast,
    showToast,
  ]);

  return {
    approvePlan,
    rejectPlan,
    isApprovingPlan: approveMutation.isPending,
    isRejectingPlan: rejectMutation.isPending,
  };
}

// Owns implement-here submission wiring. Does not own session runtime internals.
function usePlanImplementationActions() {
  const setWorkspaceArrivalEvent = useSessionSelectionStore(
    (state) => state.setWorkspaceArrivalEvent,
  );
  const { getCachedWorkspaceSetupStatus } = useWorkspaceSetupStatusCache();
  const showToast = useToastStore((state) => state.show);
  const showErrorToast = useToastStore((state) => state.showError);
  const [isImplementingPlan, setIsImplementingPlan] = useState(false);
  const isImplementingPlanRef = useRef(false);
  const availability = useChatAvailabilityState();
  const { setActiveSessionConfigOption } = useSessionConfigActions();
  const { promptActiveSession } = useSessionPromptActions();
  const gitPromptEffects = useGitPromptSnapshotEffects();
  const telemetry = useProductTelemetry();

  const implementPlanHere = useCallback(function implementPlanHere(
    plan: PromptPlanAttachmentDescriptor,
  ) {
    if (!claimPlanImplementationRun(isImplementingPlanRef)) {
      return;
    }
    void (async () => {
      setIsImplementingPlan(true);
      await executePlanImplementation({
        plan,
        getHarnessState: getPlanImplementationHarnessState,
        setActiveSessionConfigOption,
        promptActiveSession,
        startLatencyFlow: startPromptLatencyFlow,
        failLatencyFlow: failPromptLatencyFlow,
        // A send-blocked composer (missing worktree) blocks plan
        // implementation the same as a fully disabled one — the editor stays
        // editable in that state, but nothing may be sent.
        isChatDisabled: availability.isDisabled || Boolean(availability.sendBlockedReason),
        chatDisabledReason: availability.disabledReason ?? availability.sendBlockedReason,
        onPromptSubmitted: ({ workspaceId, agentKind, reuseSession }) => {
          const logicalWorkspaceId =
            useSessionSelectionStore.getState().selectedLogicalWorkspaceId;
          completeChatPromptSubmitSideEffects({
            workspaceId,
            logicalWorkspaceId,
            repoRootId: gitPromptEffects.repoRootIdForLogicalWorkspace(logicalWorkspaceId),
            getWorkspaceArrivalEvent: () =>
              useSessionSelectionStore.getState().workspaceArrivalEvent,
            getCachedWorkspaceSetupStatus,
            agentKind,
            reuseSession,
            setWorkspaceArrivalEvent,
          }, { trackProductEvent: telemetry.track, ...gitPromptEffects.promptSubmitDeps });
        },
        showToast,
        showErrorToast,
        // The in-flight claim is released in the `finally` below, so by the time
        // a person can press Retry this call is free to run again.
        retry: () => implementPlanHere(plan),
      });
    })().finally(() => {
      isImplementingPlanRef.current = false;
      setIsImplementingPlan(false);
    });
  }, [
    promptActiveSession,
    availability.disabledReason,
    availability.isDisabled,
    availability.sendBlockedReason,
    getCachedWorkspaceSetupStatus,
    gitPromptEffects,
    setActiveSessionConfigOption,
    setWorkspaceArrivalEvent,
    showErrorToast,
    showToast,
    telemetry,
  ]);

  return {
    implementPlanHere,
    isImplementingPlan,
  };
}

function getPlanImplementationHarnessState(): PlanImplementationHarnessState {
  return {
    activeSessionId: useSessionSelectionStore.getState().activeSessionId,
    sessionRecords: getSessionRecords(),
  };
}


