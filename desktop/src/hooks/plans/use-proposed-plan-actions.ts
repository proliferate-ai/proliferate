import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AnyHarnessError,
  type ContentPart,
  type NormalizedSessionControl,
  type PromptInputBlock,
} from "@anyharness/sdk";
import {
  useApprovePlanMutation,
  useRejectPlanMutation,
} from "@anyharness/sdk-react";
import { completeChatPromptSubmitSideEffects } from "@/hooks/chat/chat-submit-effects";
import { useChatAvailabilityState } from "@/hooks/chat/use-chat-availability-state";
import { useReviewActions } from "@/hooks/reviews/use-review-actions";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { createPromptId } from "@/lib/domain/chat/prompt-id";
import { type PromptPlanAttachmentDescriptor } from "@/lib/domain/chat/prompt-content";
import { buildPlanImplementationPrompt } from "@/lib/domain/plans/implementation-prompt";
import { resolvePlanImplementationModeSwitch } from "@/lib/domain/plans/implementation-mode";
import {
  failLatencyFlow as failPromptLatencyFlow,
  startLatencyFlow as startPromptLatencyFlow,
  type StartLatencyFlowInput,
} from "@/lib/infra/latency-flow";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";

type PlanImplementationSessionSlot = {
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
  sessionSlots: Record<string, PlanImplementationSessionSlot | undefined>;
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
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const setWorkspaceArrivalEvent = useHarnessStore((state) => state.setWorkspaceArrivalEvent);
  const showToast = useToastStore((state) => state.show);
  const [isImplementingPlan, setIsImplementingPlan] = useState(false);
  const isImplementingPlanRef = useRef(false);
  const availability = useChatAvailabilityState();
  const approveMutation = useApprovePlanMutation({ workspaceId: selectedWorkspaceId });
  const rejectMutation = useRejectPlanMutation({ workspaceId: selectedWorkspaceId });
  const reviewActions = useReviewActions();
  const { promptActiveSession, setActiveSessionConfigOption } = useSessionActions();
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
    if (!claimPlanImplementationRun(isImplementingPlanRef)) {
      return;
    }
    void (async () => {
      setIsImplementingPlan(true);
      await executePlanImplementation({
        plan,
        getHarnessState: useHarnessStore.getState,
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
    isApprovingPlan: approveMutation.isPending,
    isRejectingPlan: rejectMutation.isPending,
    isImplementingPlan,
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
  const planSessionSlot = harnessState.sessionSlots[plan.sourceSessionId] ?? null;
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
    latestHarnessState.sessionSlots[plan.sourceSessionId] ?? null;
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

function isPlanDecisionVersionConflict(error: unknown): boolean {
  return error instanceof AnyHarnessError
    && error.problem.status === 409
    && error.problem.code === "PLAN_DECISION_VERSION_CONFLICT";
}
