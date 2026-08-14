import { useCallback, useMemo, useState } from "react";
import type { WorkflowRunV2 } from "@anyharness/sdk";
import { useWorkflowRunsQuery } from "@anyharness/sdk-react";
import { useWorkflowRunResume } from "#product/hooks/access/anyharness/workflows/use-workflow-run-resume";
import { useWorkspaceNavigationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import { isWorkflowsV2Enabled } from "#product/lib/domain/capabilities/workflows-v2";

/**
 * sessionStorage idiom mirrors the workflows beta-gate acknowledgement in
 * `WorkflowsPage.tsx`: scoped to the browser session, best-effort (privacy
 * modes/embedded webviews can throw on read or write), and the safe failure
 * direction here is "nothing dismissed" — a storage outage must never hide a
 * parked run from the person who needs to resume it.
 */
const RESUME_DISMISSED_STORAGE_KEY = "proliferate.workflows-v2.resume-dismissed";

function readDismissedRunIds(): ReadonlySet<string> {
  try {
    const raw = window.sessionStorage.getItem(RESUME_DISMISSED_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id): id is string => typeof id === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function persistDismissedRunIds(ids: ReadonlySet<string>): void {
  try {
    window.sessionStorage.setItem(RESUME_DISMISSED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Best-effort only; the in-memory state still hides the row for this session.
  }
}

/** Pure filter, exported so the filtering rule is unit-testable independent of the query/store wiring around it. */
export function selectInterruptedRuns(
  runs: readonly WorkflowRunV2[],
  dismissedIds: ReadonlySet<string>,
): WorkflowRunV2[] {
  return runs.filter((run) => run.status === "interrupted" && !dismissedIds.has(run.id));
}

export interface UseWorkflowResumePopoverResult {
  interruptedRuns: WorkflowRunV2[];
  dismiss: (runId: string) => void;
  resumeAndOpen: (runId: string) => void;
}

/**
 * Startup detection for the resume popover: every interrupted run this
 * runtime knows about, across every workspace — `useWorkflowRunsQuery()`
 * called with no workspace id, which is that hook's own doc comment naming
 * this exact cross-workspace scan as its second intended consumer beside the
 * (workspace-scoped) run view — minus whatever the user dismissed this
 * session.
 *
 * Gated on the workflows gen-2 launch flag: off means the query never fires
 * (`enabled: false` on the query itself, not just an empty result filtered
 * client-side afterward), so a flagged-off build never opens a poll for a
 * surface nobody can reach.
 */
export function useWorkflowResumePopover(): UseWorkflowResumePopoverResult {
  const enabled = isWorkflowsV2Enabled();
  const { data } = useWorkflowRunsQuery(undefined, { enabled });
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(readDismissedRunIds);
  const resumeRun = useWorkflowRunResume();
  const { selectWorkspaceFromSurface } = useWorkspaceNavigationWorkflow();

  // Explicit guard, not just reliance on react-query returning `undefined`
  // while disabled: a query that was enabled earlier in the session and then
  // flips off keeps its last-fetched cache entry (`enabled: false` only stops
  // refetching), so a flag flip mid-session must not surface stale runs.
  const runs = enabled ? data?.runs ?? [] : [];
  const interruptedRuns = useMemo(
    () => selectInterruptedRuns(runs, dismissedIds),
    [runs, dismissedIds],
  );

  const dismiss = useCallback((runId: string) => {
    setDismissedIds((current) => {
      if (current.has(runId)) {
        return current;
      }
      const next = new Set(current);
      next.add(runId);
      persistDismissedRunIds(next);
      return next;
    });
  }, []);

  const resumeAndOpen = useCallback((runId: string) => {
    const targetWorkspaceId = runs.find((run) => run.id === runId)?.workspaceId ?? null;
    // Dismiss immediately: the runs list has no push channel and no
    // refetch interval, so waiting on it to notice the resume would leave a
    // just-resumed run sitting in the popover until the next poll.
    dismiss(runId);
    void resumeRun(runId)
      .catch(() => {
        // Best effort: a resume failure (e.g. the run was already resumed
        // from another tab or window) still leaves the run's workspace worth
        // a look, so navigation proceeds either way rather than trapping the
        // user on this popover.
      })
      .finally(() => {
        if (targetWorkspaceId) {
          selectWorkspaceFromSurface(targetWorkspaceId, "workflow-resume-popover");
        }
      });
  }, [runs, dismiss, resumeRun, selectWorkspaceFromSurface]);

  return { interruptedRuns, dismiss, resumeAndOpen };
}
