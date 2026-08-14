import { useCallback, useMemo, useState } from "react";
import type { WorkflowRunV2 } from "@anyharness/sdk";
import { useWorkflowRunProjectionWriter, useWorkflowRunsQuery } from "@anyharness/sdk-react";
import { WORKFLOW_RESUME_COPY } from "#product/copy/workflows/workflow-resume-copy";
import { useWorkflowRunResume } from "#product/hooks/access/anyharness/workflows/use-workflow-run-resume";
import { useWorkspaceNavigationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import { isWorkflowsV2Enabled } from "#product/lib/domain/capabilities/workflows-v2";
import { toastError } from "#product/primitives/utils/show-toast";

/**
 * sessionStorage idiom mirrors the workflows beta-gate acknowledgement in
 * `WorkflowsPage.tsx`: scoped to the browser session, best-effort (privacy
 * modes/embedded webviews can throw on read or write), and the safe failure
 * direction here is "nothing dismissed" — a storage outage must never hide a
 * parked run from the person who needs to resume it.
 *
 * The stored value is a `{ runId: updatedAt }` record, not a list of ids. A bare
 * id says "never show this run again this session", which is wrong twice over: a
 * run that is interrupted, dismissed, resumed elsewhere and then interrupted
 * *again* is a new, unanswered interruption, and the id-keyed shape cannot tell
 * it from the one the user already waved off. The stamp names the state that was
 * dismissed, so any other state is unanswered.
 */
const RESUME_DISMISSED_STORAGE_KEY = "proliferate.workflows-v2.resume-dismissed";

/** Run id → the `updatedAt` the user dismissed that run at. */
export type DismissedRunStamps = ReadonlyMap<string, string>;

/** Stable empty list: `data?.runs ?? []` would mint a new array every render. */
const NO_RUNS: readonly WorkflowRunV2[] = [];

function readDismissedRunStamps(): DismissedRunStamps {
  try {
    const raw = window.sessionStorage.getItem(RESUME_DISMISSED_STORAGE_KEY);
    if (!raw) {
      return new Map();
    }
    const parsed: unknown = JSON.parse(raw);
    // Records only. This key's previous shape was a bare id array, which cannot
    // express the stamp rule at all; an unrecognised shape degrades to "nothing
    // dismissed", which is the safe direction this key already documents (worst
    // case a run the user waved off earlier in the same session nudges once
    // more — never a parked run staying hidden).
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return new Map();
    }
    return new Map(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return new Map();
  }
}

function persistDismissedRunStamps(stamps: DismissedRunStamps): void {
  try {
    window.sessionStorage.setItem(
      RESUME_DISMISSED_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(stamps)),
    );
  } catch {
    // Best-effort only; the in-memory state still hides the row for this session.
  }
}

/**
 * Pure filter, exported so the filtering rule is unit-testable independent of
 * the query/store wiring around it.
 *
 * Dismissal is exact-match on `updatedAt`, deliberately not "dismissed at a
 * stamp no older than this one": exact equality needs no assumption about
 * timestamp format, precision or clock monotonicity, and every way it can be
 * wrong errs towards nudging. A run whose state is not the exact state the user
 * dismissed is a run the user has not answered.
 */
export function selectInterruptedRuns(
  runs: readonly WorkflowRunV2[],
  dismissedStamps: DismissedRunStamps,
): WorkflowRunV2[] {
  return runs.filter(
    (run) => run.status === "interrupted" && dismissedStamps.get(run.id) !== run.updatedAt,
  );
}

/**
 * What reaches the user's toast Details strip. Kept to the two shapes a rejected
 * runtime call actually produces; anything else has no text worth printing, and
 * `String(unknown)` would print `[object Object]` into an error report.
 */
function describeResumeFailure(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : undefined;
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
  const [dismissedStamps, setDismissedStamps] = useState<DismissedRunStamps>(
    readDismissedRunStamps,
  );
  const resumeRun = useWorkflowRunResume();
  const writeRunProjection = useWorkflowRunProjectionWriter();
  const { selectWorkspaceFromSurface } = useWorkspaceNavigationWorkflow();

  // Explicit guard, not just reliance on react-query returning `undefined`
  // while disabled: a query that was enabled earlier in the session and then
  // flips off keeps its last-fetched cache entry (`enabled: false` only stops
  // refetching), so a flag flip mid-session must not surface stale runs.
  const runs = enabled ? data?.runs ?? NO_RUNS : NO_RUNS;
  const interruptedRuns = useMemo(
    () => selectInterruptedRuns(runs, dismissedStamps),
    [runs, dismissedStamps],
  );

  const dismiss = useCallback((runId: string) => {
    const stamp = runs.find((run) => run.id === runId)?.updatedAt;
    if (stamp === undefined) {
      // The run left the list between render and click. There is no state to
      // record, and stamping a guess would either hide the wrong interruption
      // or fail to hide the right one.
      return;
    }
    setDismissedStamps((current) => {
      if (current.get(runId) === stamp) {
        return current;
      }
      const next = new Map(current);
      next.set(runId, stamp);
      persistDismissedRunStamps(next);
      return next;
    });
  }, [runs]);

  const resumeAndOpen = useCallback((runId: string) => {
    const targetWorkspaceId = runs.find((run) => run.id === runId)?.workspaceId ?? null;
    void resumeRun(runId)
      // Two-arm `then` rather than `.then().catch()`: the rejection arm must see
      // only a failed *resume*, never a throw from the success arm below, or a
      // resume that worked would report itself as failed.
      .then(
        (projection) => {
          // Write-through, not a refetch. The resume response *is* the fresh
          // projection (the runtime's own contract: commands never need a
          // follow-up read), and a mounted run view holds its projection for
          // 30s with no refetch interval while the run is interrupted — so
          // without this write that pane sits on a stale "this run is paused"
          // banner indefinitely. Same seam the trigger flow uses
          // (`use-workflow-trigger-actions.ts`); `useWorkflowRunMutations` is
          // not available here because it binds one run id at mount and this
          // popover resumes whichever run the user picked.
          writeRunProjection(projection);
          // Dismiss only once the runtime has confirmed. A dismissal persists
          // for the whole browser session, so dismissing ahead of the request
          // meant one failed resume (a runtime mid-restart) made the run vanish
          // until the session ended, with nothing said about it.
          dismiss(runId);
        },
        (error: unknown) => {
          toastError({
            // One id per run: pressing Resume again replaces the report instead
            // of stacking a second copy of it.
            id: `workflow-resume-failed:${runId}`,
            headline: WORKFLOW_RESUME_COPY.resumeFailedHeadline,
            consequence: WORKFLOW_RESUME_COPY.resumeFailedConsequence,
            cause: describeResumeFailure(error),
          });
        },
      )
      .finally(() => {
        if (targetWorkspaceId) {
          // Navigation is unconditional on purpose, unchanged by this fix: the
          // run's workspace is worth a look either way, and on the failure path
          // the toast plus the row that stayed put are what say the resume did
          // not happen.
          selectWorkspaceFromSurface(targetWorkspaceId, "workflow-resume-popover");
        }
      });
  }, [runs, dismiss, resumeRun, selectWorkspaceFromSurface, writeRunProjection]);

  return { interruptedRuns, dismiss, resumeAndOpen };
}
