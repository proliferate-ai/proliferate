import { useCallback, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  AnyHarnessError,
  type ContentPart,
  type NormalizedSessionControl,
  type PlanDecisionResponse,
  type PromptInputBlock,
  type ProposedPlanDetail,
  type ProposedPlanSummary,
} from "@anyharness/sdk";
import {
  anyHarnessPlanKey,
  anyHarnessPlansKey,
  useApprovePlanMutation,
  useFetchPlanMutation,
  useRejectPlanMutation,
} from "@anyharness/sdk-react";
import { completeChatPromptSubmitSideEffects } from "@/hooks/chat/chat-submit-effects";
import { useChatAvailabilityState } from "@/hooks/chat/use-chat-availability-state";
import { useReviewActions } from "@/hooks/reviews/use-review-actions";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { createPromptId } from "@/lib/domain/chat/composer/prompt-id";
import { type PromptPlanAttachmentDescriptor } from "@/lib/domain/chat/composer/prompt-content";
import { buildPlanImplementationPrompt } from "@/lib/domain/plans/implementation-prompt";
import { resolvePlanImplementationModeSwitch } from "@/lib/domain/plans/implementation-mode";
import { patchProposedPlanDecisionInTranscript } from "@/lib/domain/plans/proposed-plan-transcript";
import {
  failLatencyFlow as failPromptLatencyFlow,
  startLatencyFlow as startPromptLatencyFlow,
  type StartLatencyFlowInput,
} from "@/lib/infra/measurement/latency-flow";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import {
  getSessionRecord,
  getSessionRecords,
  patchSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";

type PlanImplementationSessionRecord = {
  workspaceId: string | null;
  agentKind?: string | null;
  liveConfig: {
    normalizedControls: {
      collaborationMode?: NormalizedSessionControl | null;
      mode?: NormalizedSessionControl | null;
    };
  } | null;
};

interface PlanImplementationHarnessState {
  activeSessionId: string | null;
  sessionRecords: Record<string, PlanImplementationSessionRecord | undefined>;
}

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

export function useProposedPlanActions() {
  const queryClient = useQueryClient();
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const setWorkspaceArrivalEvent = useSessionSelectionStore(
    (state) => state.setWorkspaceArrivalEvent,
  );
  const showToast = useToastStore((state) => state.show);
  const [isImplementingPlan, setIsImplementingPlan] = useState(false);
  const isImplementingPlanRef = useRef(false);
  const availability = useChatAvailabilityState();
  const approveMutation = useApprovePlanMutation({ workspaceId: selectedWorkspaceId });
  const rejectMutation = useRejectPlanMutation({ workspaceId: selectedWorkspaceId });
  const fetchPlanMutation = useFetchPlanMutation({ workspaceId: selectedWorkspaceId });
  const reviewActions = useReviewActions();
  const { promptActiveSession, setActiveSessionConfigOption } = useSessionActions();
  const approvePlanMutation = approveMutation.mutateAsync;
  const rejectPlanMutation = rejectMutation.mutateAsync;

  const applyPlanDecision = useCallback((plan: ProposedPlanDetail) => {
    patchCachedPlanQueries(queryClient, runtimeUrl, selectedWorkspaceId, plan);
    patchCachedPlanTranscripts(plan);
  }, [queryClient, runtimeUrl, selectedWorkspaceId]);

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
            queryClient,
            runtimeUrl,
            workspaceId,
            agentKind,
            reuseSession,
            setWorkspaceArrivalEvent,
          }),
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
    queryClient,
    runtimeUrl,
    setActiveSessionConfigOption,
    setWorkspaceArrivalEvent,
    showToast,
  ]);

  return {
    approvePlan,
    rejectPlan,
    implementPlanHere,
    reviewPlan: reviewActions.startPlanReview,
    configurePlanReview: reviewActions.configurePlanReview,
    isApprovingPlan: approveMutation.isPending,
    isRejectingPlan: rejectMutation.isPending,
    isImplementingPlan,
    isStartingReview: reviewActions.isStartingReview,
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

function patchCachedPlanQueries(
  queryClient: QueryClient,
  runtimeUrl: string | null,
  workspaceId: string | null,
  plan: ProposedPlanDetail,
): void {
  queryClient.setQueryData(
    anyHarnessPlanKey(runtimeUrl, workspaceId, plan.id),
    plan,
  );
  queryClient.setQueryData<ProposedPlanSummary[]>(
    anyHarnessPlansKey(runtimeUrl, workspaceId),
    (plans) => plans?.map((cachedPlan) => (
      cachedPlan.id === plan.id ? { ...cachedPlan, ...plan } : cachedPlan
    )),
  );
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
  const planSessionSlot = harnessState.sessionRecords[plan.sourceSessionId] ?? null;
  if (!planSessionSlot) {
    showToast("Plan session is not available.");
    return;
  }
  if (harnessState.activeSessionId !== plan.sourceSessionId) {
    showToast("Select the plan's session before carrying it out.");
    return;
  }
  const workspaceId = planSessionSlot.workspaceId;
  if (!workspaceId) {
    showToast("Select a workspace before implementing a plan.");
    return;
  }
  if (isChatDisabled) {
    showToast(chatDisabledReason ?? "Chat is unavailable.");
    return;
  }

  const prompt = buildPlanImplementationPrompt(plan);
  const promptId = createPromptId();
  const latencyFlowId = startLatencyFlow({
    flowKind: "prompt_submit",
    source: "plan_card_implement_here",
    targetSessionId: plan.sourceSessionId,
    targetWorkspaceId: workspaceId,
    promptId,
  });

  const modeSwitch = resolvePlanImplementationModeSwitch({
    collaborationMode:
      planSessionSlot.liveConfig?.normalizedControls.collaborationMode ?? null,
    mode: planSessionSlot.liveConfig?.normalizedControls.mode ?? null,
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
  const latestPlanSessionSlot =
    latestHarnessState.sessionRecords[plan.sourceSessionId] ?? null;
  if (
    latestHarnessState.activeSessionId !== plan.sourceSessionId
    || latestPlanSessionSlot?.workspaceId !== workspaceId
  ) {
    failLatencyFlow(latencyFlowId, "plan_implementation_target_changed");
    showToast("Select the plan's session before carrying it out.");
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
      workspaceId,
      agentKind: planSessionSlot.agentKind ?? "unknown",
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
