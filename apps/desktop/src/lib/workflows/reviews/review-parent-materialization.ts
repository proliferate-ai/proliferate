import type {
  StartCodeReviewRequest,
  StartPlanReviewRequest,
} from "@anyharness/sdk";
import {
  waitForSessionMaterialization,
  type SessionMaterializationDeps,
} from "@/lib/workflows/sessions/session-materialization";

// Review launch is a user-triggered overlay action; fail quickly so the user
// can retry instead of leaving the setup dialog in an ambiguous starting state.
const REVIEW_PARENT_SESSION_MATERIALIZATION_TIMEOUT_MS = 5_000;

export function waitForReviewParentSessionMaterialization(
  parentSessionId: string,
  deps: SessionMaterializationDeps,
): Promise<string> {
  return waitForSessionMaterialization(
    parentSessionId,
    deps,
    { timeoutMs: REVIEW_PARENT_SESSION_MATERIALIZATION_TIMEOUT_MS },
  );
}

export function materializeReviewParentSession<
  TRequest extends StartPlanReviewRequest | StartCodeReviewRequest,
>(
  request: TRequest,
  materializedParentSessionId: string,
): TRequest {
  return {
    ...request,
    parentSessionId: materializedParentSessionId,
  };
}
