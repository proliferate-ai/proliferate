import { useCallback, useRef, useState } from "react";
import {
  AnyHarnessError,
  type ContentPart,
  type PlanDecisionResponse,
  type PromptInputBlock,
  type ProposedPlanDetail,
} from "@anyharness/sdk";
import {
  useApprovePlanMutation,
  useFetchPlanMutation,
  useRejectPlanMutation,
} from "@anyharness/sdk-react";
import { useWorkspaceSetupStatusCache } from "@/hooks/access/anyharness/workspaces/use-workspace-setup-status-cache";
import { useChatAvailabilityState } from "@/hooks/chat/derived/use-chat-availability-state";
import { useProposedPlanCache } from "@/hooks/plans/cache/use-proposed-plan-cache";
import { useReviewActions } from "@/hooks/reviews/workflows/use-review-actions";
import { useSessionConfigActions } from "@/hooks/sessions/workflows/use-session-config-actions";
import { useSessionPromptActions } from "@/hooks/sessions/workflows/use-session-prompt-actions";
import { createPromptId } from "@/lib/domain/chat/composer/prompt-id";
import { type PromptPlanAttachmentDescriptor } from "@proliferate/product-model/chats/composer/prompt-plan-attachments";
import { buildPlanImplementationPrompt } from "@/lib/domain/plans/implementation-prompt";
import { resolvePlanImplementationModeSwitch } from "@/lib/domain/plans/implementation-mode";
import {
  resolvePlanImplementationReadiness,
  resolvePlanImplementationTargetCheck,
  type PlanImplementationHarnessState,
} from "@/lib/domain/plans/implementation-target";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";
import {
  failLatencyFlow as failPromptLatencyFlow,
  startLatencyFlow as startPromptLatencyFlow,
  type StartLatencyFlowInput,
} from "@/lib/infra/measurement/latency-flow";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { completeChatPromptSubmitSideEffects } from "@/lib/workflows/chat/complete-chat-prompt-submit-side-effects";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { getSessionRecords } from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";

interface PromptActiveSessionOptions {
  latencyFlowId?: string | null;
  promptId?: string | null;
  blocks?: PromptInputBlock[];
  optimisticContentParts?: ContentPart[];
}

interface ExecutePlanImplementationInput {
  plan: PromptPlanAttachmentDescriptor;
  getHarnessState: () => PlanImplementationHarnessState;
  setActiveSessionConfigOption: (
    configId: string,
    value: string,
    options?: { persistDefaultPreference?: boolean },
  ) => Promise<unknown>;
  promptActiveSession: (
    text: string,
    options?: PromptActiveSessionOptions,
  ) => Promise<void>;
  startLatencyFlow: (input: StartLatencyFlowInput) => string;
  failLatencyFlow: (
    flowId: string | null | undefined,
    reason: string,
    extraFields?: Record<string, unknown>,
  ) => void;
  isChatDisabled: boolean;
  chatDisabledReason: string | null;
  onPromptSubmitted: (input: {
    workspaceId: string;
    agentKind: string;
    reuseSession: boolean;
  }) => void;
  showToast: (message: string) => void;
}

// Compatibility facade for proposed-plan card actions.
export function useProposedPlanActions() {
  const decisionActions = useProposedPlanDecisionActions();
  const implementationActions = usePlanImplementationActions();
  const reviewActions = useReviewActions();

  return {
    approvePlan: decisionActions.approvePlan,
    rejectPlan: decisionActions.rejectPlan,
    implementPlanHere: implementationActions.implementPlanHere,
    reviewPlan: reviewActions.startPlanReview,
    configurePlanReview: reviewActions.configurePlanReview,
    isApprovingPlan: decisionActions.isApprovingPlan,
    isRejectingPlan: decisionActions.isRejectingPlan,
    isImplementingPlan: implementationActions.isImplementingPlan,
    isStartingReview: reviewActions.isStartingReview,
  };
}

// Owns approve/reject actions and decision-conflict refresh behavior.
function useProposedPlanDecisionActions() {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const showToast = useToastStore((state) => state.show);
  const approveMutation = useApprovePlanMutation({ workspaceId: selectedWorkspaceId });
  const rejectMutation = useRejectPlanMutation({ workspaceId: selectedWorkspaceId });
  const fetchPlanMutation = useFetchPlanMutation({ workspaceId: selectedWorkspaceId });
  const approvePlanMutation = approveMutation.mutateAsync;
  const rejectPlanMutation = rejectMutation.mutateAsync;
  const {
    applyPlanDecisionToCache,
  } = useProposedPlanCache({
    runtimeUrl,
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

  const approvePlan = useCallback((planId: string, expectedDecisionVersion: number) => {
    void runPlanDecisionMutation({
      planId,
      expectedDecisionVersion,
      mutate: approvePlanMutation,
      applyPlanDecision,
      refreshAndApplyPlanDecision,
      showToast,
      failurePrefix: "Failed to approve plan",
    });
  }, [
    applyPlanDecision,
    approvePlanMutation,
    refreshAndApplyPlanDecision,
    showToast,
  ]);

  const rejectPlan = useCallback((planId: string, expectedDecisionVersion: number) => {
    void runPlanDecisionMutation({
      planId,
      expectedDecisionVersion,
      mutate: rejectPlanMutation,
      applyPlanDecision,
      refreshAndApplyPlanDecision,
      showToast,
      failurePrefix: "Failed to reject plan",
    });
  }, [
    applyPlanDecision,
    refreshAndApplyPlanDecision,
    rejectPlanMutation,
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
  const [isImplementingPlan, setIsImplementingPlan] = useState(false);
  const isImplementingPlanRef = useRef(false);
  const availability = useChatAvailabilityState();
  const { setActiveSessionConfigOption } = useSessionConfigActions();
  const { promptActiveSession } = useSessionPromptActions();

  const implementPlanHere = useCallback((plan: PromptPlanAttachmentDescriptor) => {
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
        isChatDisabled: availability.isDisabled,
        chatDisabledReason: availability.disabledReason,
        onPromptSubmitted: ({ workspaceId, agentKind, reuseSession }) =>
          completeChatPromptSubmitSideEffects({
            workspaceId,
            getWorkspaceArrivalEvent: () =>
              useSessionSelectionStore.getState().workspaceArrivalEvent,
            getCachedWorkspaceSetupStatus,
            agentKind,
            reuseSession,
            setWorkspaceArrivalEvent,
          }, { trackProductEvent }),
        showToast,
      });
    })().finally(() => {
      isImplementingPlanRef.current = false;
      setIsImplementingPlan(false);
    });
  }, [
    promptActiveSession,
    availability.disabledReason,
    availability.isDisabled,
    getCachedWorkspaceSetupStatus,
    setActiveSessionConfigOption,
    setWorkspaceArrivalEvent,
    showToast,
  ]);

  return {
    implementPlanHere,
    isImplementingPlan,
  };
}

async function runPlanDecisionMutation({
  planId,
  expectedDecisionVersion,
  mutate,
  applyPlanDecision,
  refreshAndApplyPlanDecision,
  showToast,
  failurePrefix,
}: {
  planId: string;
  expectedDecisionVersion: number;
  mutate: (input: {
    planId: string;
    expectedDecisionVersion: number;
  }) => Promise<PlanDecisionResponse>;
  applyPlanDecision: (plan: ProposedPlanDetail) => void;
  refreshAndApplyPlanDecision: (planId: string) => Promise<ProposedPlanDetail>;
  showToast: (message: string) => void;
  failurePrefix: string;
}): Promise<void> {
  try {
    const response = await mutate({ planId, expectedDecisionVersion });
    applyPlanDecision(response.plan);
    logLatency("plan.decision.applied", {
      planId,
      sessionId: response.plan.sessionId,
      decisionState: response.plan.decisionState,
      decisionVersion: response.plan.decisionVersion,
    });
  } catch (error) {
    if (isPlanDecisionRefreshConflict(error)) {
      try {
        await refreshAndApplyPlanDecision(planId);
        showToast("Plan decision was updated. Refreshed plan state.");
        return;
      } catch (refreshError) {
        const message = refreshError instanceof Error
          ? refreshError.message
          : String(refreshError);
        showToast(`Plan decision was updated, but refresh failed: ${message}`);
        return;
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    showToast(`${failurePrefix}: ${message}`);
  }
}

function getPlanImplementationHarnessState(): PlanImplementationHarnessState {
  return {
    activeSessionId: useSessionSelectionStore.getState().activeSessionId,
    sessionRecords: getSessionRecords(),
  };
}

export async function executePlanImplementation({
  plan,
  getHarnessState,
  setActiveSessionConfigOption,
  promptActiveSession,
  startLatencyFlow,
  failLatencyFlow,
  isChatDisabled,
  chatDisabledReason,
  onPromptSubmitted,
  showToast,
}: ExecutePlanImplementationInput): Promise<void> {
  const harnessState = getHarnessState();
  const readiness = resolvePlanImplementationReadiness({
    plan,
    harnessState,
    isChatDisabled,
    chatDisabledReason,
  });
  if (readiness.status === "blocked") {
    showToast(readiness.message);
    return;
  }

  const prompt = buildPlanImplementationPrompt(plan);
  const promptId = createPromptId();
  const latencyFlowId = startLatencyFlow({
    flowKind: "prompt_submit",
    source: "plan_card_implement_here",
    targetSessionId: plan.sourceSessionId,
    targetWorkspaceId: readiness.workspaceId,
    promptId,
  });

  const modeSwitch = resolvePlanImplementationModeSwitch({
    collaborationMode:
      readiness.session.liveConfig?.normalizedControls.collaborationMode ?? null,
    mode: readiness.session.liveConfig?.normalizedControls.mode ?? null,
  });
  if (modeSwitch) {
    try {
      await setActiveSessionConfigOption(modeSwitch.rawConfigId, modeSwitch.value, {
        persistDefaultPreference: false,
      });
    } catch (error) {
      failLatencyFlow(latencyFlowId, "plan_implementation_config_failed");
      showPlanImplementationFailureToast(showToast, error);
      return;
    }
  }

  const latestHarnessState = getHarnessState();
  const targetCheck = resolvePlanImplementationTargetCheck({
    plan,
    harnessState: latestHarnessState,
    expectedWorkspaceId: readiness.workspaceId,
  });
  if (targetCheck.status === "blocked") {
    failLatencyFlow(latencyFlowId, "plan_implementation_target_changed");
    showToast(targetCheck.message);
    return;
  }

  try {
    await promptActiveSession(prompt.text, {
      blocks: prompt.blocks,
      optimisticContentParts: prompt.optimisticContentParts,
      promptId,
      latencyFlowId,
    });
    onPromptSubmitted({
      workspaceId: readiness.workspaceId,
      agentKind: readiness.agentKind,
      reuseSession: true,
    });
  } catch (error) {
    failLatencyFlow(latencyFlowId, "plan_implementation_prompt_failed");
    showPlanImplementationFailureToast(showToast, error);
  }
}

export function claimPlanImplementationRun(ref: { current: boolean }): boolean {
  if (ref.current) {
    return false;
  }
  ref.current = true;
  return true;
}

function showPlanImplementationFailureToast(
  showToast: (message: string) => void,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  showToast(`Failed to carry out plan: ${message}`);
}

function isPlanDecisionRefreshConflict(error: unknown): boolean {
  return error instanceof AnyHarnessError
    && error.problem.status === 409
    && (
      error.problem.code === "PLAN_DECISION_VERSION_CONFLICT"
      || error.problem.code === "PLAN_DECISION_TERMINAL"
    );
}
