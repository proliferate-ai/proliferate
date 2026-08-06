import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import { isWorkspaceDirectoryMissingError } from "#product/lib/domain/sessions/creation/create-session-error";
import { createPromptId } from "#product/lib/domain/chat/composer/prompt-id";
import { type PromptPlanAttachmentDescriptor } from "#product/domain/chats/composer/prompt-plan-attachments";
import { buildPlanImplementationPrompt } from "#product/lib/domain/plans/implementation-prompt";
import { resolvePlanImplementationModeSwitch } from "#product/lib/domain/plans/implementation-mode";
import {
  resolvePlanImplementationReadiness,
  resolvePlanImplementationTargetCheck,
  type PlanImplementationHarnessState,
} from "#product/lib/domain/plans/implementation-target";
import type { StartLatencyFlowInput } from "#product/lib/infra/measurement/measurement-port";
import type { ToastErrorInput } from "#product/primitives/utils/toast-model";

interface PromptActiveSessionOptions {
  latencyFlowId?: string | null;
  promptId?: string | null;
  blocks?: PromptInputBlock[];
  optimisticContentParts?: ContentPart[];
}

export interface ExecutePlanImplementationInput {
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
  showErrorToast: (input: ToastErrorInput) => void;
  /** Re-run the whole implementation, for the error toast's Retry. */
  retry: () => void;
}

/**
 * Sends a plan to the session that will implement it: mode switch first, then
 * a re-check that the target has not moved, then the prompt.
 *
 * Blocked states use a plain status toast — nothing was attempted, so there is
 * no failure to report. Only the two steps that can half-succeed raise an
 * error toast, and both name the same consequence: nothing was sent.
 */
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
  showErrorToast,
  retry,
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
      showPlanImplementationFailureToast(showErrorToast, error, retry);
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
    // The persistent missing-worktree composer panel owns that condition.
    if (!isWorkspaceDirectoryMissingError(error)) {
      showPlanImplementationFailureToast(showErrorToast, error, retry);
    }
  }
}

/**
 * One guard for the whole run, so a double-click cannot send the plan twice.
 */
export function claimPlanImplementationRun(ref: { current: boolean }): boolean {
  if (ref.current) {
    return false;
  }
  ref.current = true;
  return true;
}

function showPlanImplementationFailureToast(
  showErrorToast: (input: ToastErrorInput) => void,
  error: unknown,
  retry: () => void,
): void {
  showErrorToast({
    headline: "Plan not started",
    consequence: "Nothing was sent to the session and no files were touched.",
    cause: error instanceof Error ? error.message : String(error),
    retry,
  });
}
