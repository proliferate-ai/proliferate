import { ProliferateClientError } from "@proliferate/cloud-sdk";

import type { MobilePendingPrompt } from "../../../navigation/navigation-model";

const RETRYABLE_READINESS_ERROR_CODES = new Set([
  "cloud_command_target_config_required",
  "cloud_command_runtime_config_missing",
  "cloud_command_runtime_config_not_ready",
  "cloud_command_agent_auth_not_ready",
  "runtime_config_not_ready",
  "agent_auth_not_ready",
]);

const RETRYABLE_FAILURE_PATTERNS = [
  "timed out waiting for the cloud session to start",
  "timed out waiting for the cloud command to be accepted",
  "could not load existing sessions before starting a new one",
];

export class RetryablePendingPromptDispatchError extends Error {
  readonly retryable = true;
}

export function shouldRetryPendingMobilePromptFailure(
  prompt: Pick<MobilePendingPrompt, "failedAt" | "failureMessage">,
): boolean {
  if (!prompt.failedAt || !prompt.failureMessage) {
    return false;
  }
  return isRetryablePendingPromptFailureMessage(prompt.failureMessage);
}

export function rearmRetryablePendingMobilePrompt(
  prompt: MobilePendingPrompt,
): MobilePendingPrompt {
  if (!shouldRetryPendingMobilePromptFailure(prompt)) {
    return prompt;
  }
  return {
    ...prompt,
    failedAt: null,
    failureMessage: null,
  };
}

export function isRetryableReadinessErrorCode(code: string | null | undefined): boolean {
  return Boolean(code && RETRYABLE_READINESS_ERROR_CODES.has(code));
}

export function retryableReadinessError(
  error: unknown,
): RetryablePendingPromptDispatchError | null {
  if (
    error instanceof Error
    && isRetryablePendingPromptFailureMessage(error.message)
  ) {
    return new RetryablePendingPromptDispatchError(error.message);
  }
  if (
    error instanceof ProliferateClientError
    && error.status === 409
    && isRetryableReadinessErrorCode(error.code)
  ) {
    return new RetryablePendingPromptDispatchError(
      error.message || "Workspace runtime is still preparing for session start.",
    );
  }
  return null;
}

function isRetryablePendingPromptFailureMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return RETRYABLE_FAILURE_PATTERNS.some((pattern) => normalized.includes(pattern));
}
