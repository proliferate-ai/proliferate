import { useCallback } from "react";
import { AnyHarnessError } from "@anyharness/sdk";
import { WORKFLOW_RUN_VIEW_COPY } from "#product/copy/workflows/workflow-run-view-copy";
import { recordRendererDiagnostic } from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import { showToast, toastError } from "#product/primitives/utils/show-toast";

/** Stable class from the error's shape (problem code or name), never its text. */
function classifyCommandError(error: unknown): string {
  if (error instanceof AnyHarnessError) {
    return error.problem.code;
  }
  return error instanceof Error ? error.name : "unknown";
}

/**
 * Whether a rejected command lost a race with the run rather than failing.
 *
 * The runtime answers an illegal transition with `WORKFLOW_TRANSITION_ILLEGAL`
 * (HTTP 409). Because `workflowNodeControls` renders a control only where the
 * transition table has a row for it, that answer never means the UI offered
 * something impossible — it means the run moved between the render and the
 * click. Matched on the stable problem code, not the status: the code is the
 * contract and the status is the transport's rendering of it.
 */
export function isWorkflowTransitionRace(error: unknown): boolean {
  return (
    error instanceof AnyHarnessError
    && error.problem.code === "WORKFLOW_TRANSITION_ILLEGAL"
  );
}

function describeCause(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : undefined;
}

/**
 * Runs one workflow-run command under the shared failure policy: a 409 race
 * becomes a per-run warning toast plus a refresh, and anything else becomes an
 * error toast carrying the cause. Either way the rejection never reaches the
 * caller that fired the control.
 *
 * Shared rather than inlined per surface because two places fire commands on
 * the same run — the pane's controls, and the panel-independent undo offer on
 * the auto-advance toast — and what a 409 means must not be decided twice.
 */
export function useWorkflowRunCommand({
  runId,
  refetchRun,
}: {
  runId: string;
  refetchRun: () => unknown;
}): (command: () => Promise<unknown>) => Promise<void> {
  return useCallback(async (command: () => Promise<unknown>) => {
    try {
      await command();
    } catch (error) {
      if (isWorkflowTransitionRace(error)) {
        recordRendererDiagnostic({
          name: "renderer.workflows.run_command_race",
          severity: "warn",
          kind: "message",
          privacy: "operational",
          correlation: { workflowId: runId },
          errorClassification: "WORKFLOW_TRANSITION_ILLEGAL",
        });
        // The control raced the run: say so, refresh, and never let the
        // rejection reach the component that rendered the control.
        showToast({
          id: `workflow-run-race:${runId}`,
          weight: "announcement",
          tone: "warning",
          badge: WORKFLOW_RUN_VIEW_COPY.toastBadge,
          title: WORKFLOW_RUN_VIEW_COPY.raceTitle,
          description: WORKFLOW_RUN_VIEW_COPY.raceDescription,
        });
        void refetchRun();
        return;
      }
      recordRendererDiagnostic({
        name: "renderer.workflows.run_command_failed",
        severity: "error",
        kind: "message",
        privacy: "operational",
        correlation: { workflowId: runId },
        errorClassification: classifyCommandError(error),
      });
      toastError({
        headline: WORKFLOW_RUN_VIEW_COPY.commandFailedHeadline,
        consequence: WORKFLOW_RUN_VIEW_COPY.commandFailedConsequence,
        cause: describeCause(error),
      });
    }
  }, [refetchRun, runId]);
}
