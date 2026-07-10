import { useMemo } from "react";
// Side-effect: registers the auth-aware desktop cloud client factory.
import "@/lib/access/cloud/client";
import {
  claimLocalWorkflowRuns,
  heartbeatLocalWorkflowRun,
  listWorkflowTriggers,
  reportWorkflowRunStatus,
} from "@/lib/access/cloud/workflows";

/**
 * The cloud calls the desktop workflow claim poller makes (track 2a). Owns no
 * cache shape or runtime-client construction — just the auth-aware access seam,
 * mirroring `use-local-automation-run-claims`.
 *
 * A claimed run's failure is reported through the SAME `/status` path the relay
 * uses (`reportFailed`) — the claim IS the local delivery, so there is no separate
 * fail endpoint; `claimed -> failed` is a legal transition that expires the run's
 * gateway token exactly like the cloud lane.
 */
export function useLocalWorkflowRunClaims() {
  return useMemo(
    () => ({
      claimRuns: claimLocalWorkflowRuns,
      heartbeatRun: heartbeatLocalWorkflowRun,
      listTriggers: listWorkflowTriggers,
      reportFailed: (
        runId: string,
        errorCode: string,
        // The claim this executor holds (2a): a `claimed -> failed` report is an
        // owner-authed /status call, so it must carry the claim id like every other
        // relayed report or the server rejects it as an unclaimed local report.
        claimId: string,
        errorMessage?: string,
      ) =>
        reportWorkflowRunStatus(runId, {
          status: "failed",
          errorCode,
          errorMessage: errorMessage ?? null,
          claimId,
        }),
    }),
    [],
  );
}
