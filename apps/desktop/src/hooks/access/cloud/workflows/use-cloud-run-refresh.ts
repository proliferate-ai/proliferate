import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
// Side-effect: registers the auth-aware desktop cloud client factory.
import "@/lib/access/cloud/client";
import { refreshWorkflowRun } from "@/lib/access/cloud/workflows";
import { workflowRunDetailKey } from "./query-keys";

const CLOUD_REFRESH_INTERVAL_MS = 3000;

/**
 * Poll the server's cloud-run refresh endpoint (spec 3.2): cloud runs have no
 * worker→server push channel in v1, so this pulls observed state from the sandbox
 * through the gateway and syncs the ledger, feeding the run-view query cache.
 * Only runs while a cloud run is non-terminal.
 */
export function useCloudRunRefreshPoll(runId: string | null, enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !runId) {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const run = await refreshWorkflowRun(runId);
        if (!cancelled) {
          queryClient.setQueryData(workflowRunDetailKey(runId), run);
        }
      } catch {
        // Transient gateway/sandbox error — retry on the next tick.
      }
    };
    void tick();
    const timer = setInterval(tick, CLOUD_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId, enabled, queryClient]);
}
