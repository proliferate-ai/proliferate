import {
  AnyHarnessError,
  type PlanDecisionResponse,
  type ProposedPlanDetail,
} from "@anyharness/sdk";
import { logLatency } from "#product/lib/infra/measurement/measurement-port";
import type { ToastErrorInput } from "#product/primitives/utils/toast-model";

/**
 * Applies an approve/reject decision, reconciling the one conflict the runtime
 * can answer with: someone else decided the plan first.
 *
 * Module-level and outside the hook file so the decision path and the
 * implementation path can each be read on their own.
 */
export async function runPlanDecisionMutation({
  planId,
  expectedDecisionVersion,
  mutate,
  applyPlanDecision,
  refreshAndApplyPlanDecision,
  showToast,
  showErrorToast,
  failure,
  retry,
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
  showErrorToast: (input: ToastErrorInput) => void;
  /**
   * The two written lines for this decision, chosen by the caller. A pair of
   * literals rather than a prefix to interpolate: approve and reject are
   * different outcomes to a person, so each gets its own copy instead of one
   * template with the verb swapped in.
   */
  failure: { headline: string; consequence: string };
  retry: () => void;
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
        // The decision landed somewhere else and this client could not read it
        // back, so the headline reports the read, not the decision.
        showErrorToast({
          headline: "Plan state not refreshed",
          consequence: "Someone already decided this plan. Reopen it to see where it landed.",
          cause: refreshError instanceof Error
            ? refreshError.message
            : String(refreshError),
          retry: () => void refreshAndApplyPlanDecision(planId),
        });
        return;
      }
    }

    showErrorToast({
      headline: failure.headline,
      consequence: failure.consequence,
      cause: error instanceof Error ? error.message : String(error),
      retry,
    });
  }
}

function isPlanDecisionRefreshConflict(error: unknown): boolean {
  return error instanceof AnyHarnessError
    && error.problem.status === 409
    && (
      error.problem.code === "PLAN_DECISION_VERSION_CONFLICT"
      || error.problem.code === "PLAN_DECISION_TERMINAL"
    );
}
