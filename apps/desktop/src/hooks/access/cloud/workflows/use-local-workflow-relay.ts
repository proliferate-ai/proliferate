import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
// Side-effect: registers the auth-aware desktop cloud client factory.
import "@/lib/access/cloud/client";
import {
  listWorkflowRuns,
  reportWorkflowRunStatus,
} from "@/lib/access/cloud/workflows";
import { getLocalWorkflowRun } from "@/lib/access/anyharness/workflow-runs";
import {
  initialRelayState,
  planRelayReports,
  type RelayRunState,
} from "@/lib/domain/workflows/relay";
import { shouldReattachLocalRun } from "@/lib/domain/workflows/local-executor";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import {
  useWorkflowRelayStore,
  type RelayRunRegistration,
} from "@/stores/workflows/workflow-relay-store";
import { workflowRunDetailKey, workflowRunsKey } from "./query-keys";

const RELAY_POLL_INTERVAL_MS = 2000;

/**
 * Top-level relay for the desktop lane (spec 3.2). While the app is open it polls
 * every registered local run's LOCAL runtime view and forwards observed
 * transitions to the server `/status` endpoint (the server stays the single
 * source of truth the run view reads). Terminal runs deregister. On mount it
 * re-attaches non-terminal local runs so an app restart re-arms the relay.
 *
 * Mount once (see `WorkflowRelayProvider`); it survives route changes.
 */
export function useLocalWorkflowRelay(): void {
  const queryClient = useQueryClient();
  const runs = useWorkflowRelayStore((state) => state.runs);
  const unregister = useWorkflowRelayStore((state) => state.unregister);
  const register = useWorkflowRelayStore((state) => state.register);
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);

  const relayState = useRef<Map<string, RelayRunState>>(new Map());
  const inFlight = useRef<Set<string>>(new Set());
  const reattached = useRef(false);

  // Re-attach non-terminal local runs once, so a restart resumes relaying.
  useEffect(() => {
    if (reattached.current || !runtimeUrl.trim()) {
      return;
    }
    reattached.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const { runs: serverRuns } = await listWorkflowRuns();
        if (cancelled) {
          return;
        }
        for (const run of serverRuns) {
          // Re-attach any local run the server advanced past delivery + recorded a
          // workspace for (a manual local run, or a claimed scheduled run whose
          // relay already reported `running`). A still-`claimed` run with no
          // workspace is left to the claim poller to re-claim + re-deliver.
          if (shouldReattachLocalRun(run) && run.anyharnessWorkspaceId) {
            relayState.current.set(run.id, {
              ...initialRelayState(),
              // The server already advanced past delivery, so `running` is reported.
              reportedRunning: run.status !== "delivered",
            });
            register(run.id, {
              workspaceId: run.anyharnessWorkspaceId,
              runtimeUrl,
              // Thread the claim this run carries (2a) so relayed reports remain
              // authorized at claim granularity after a restart; null for a
              // manual/chat local run, which has no claim.
              claimId: run.claimId ?? null,
            });
          }
        }
      } catch {
        // Re-attach is best-effort; freshly-launched runs relay regardless.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runtimeUrl, register]);

  useEffect(() => {
    const runEntries = () => Object.entries(runs) as [string, RelayRunRegistration][];

    const relayOne = async (runId: string, registration: RelayRunRegistration) => {
      if (inFlight.current.has(runId)) {
        return;
      }
      inFlight.current.add(runId);
      try {
        const view = await getLocalWorkflowRun(
          { runtimeUrl: registration.runtimeUrl },
          runId,
        );
        const prev = relayState.current.get(runId) ?? initialRelayState();
        // Thread the held claim (2a) so each relayed report stays authorized at
        // claim granularity — the server rejects a reclaimed laptop's stale relay.
        const { reports, state } = planRelayReports(prev, view, {
          claimId: registration.claimId,
        });
        relayState.current.set(runId, state);
        for (const report of reports) {
          await reportWorkflowRunStatus(runId, report);
        }
        if (reports.length > 0) {
          await queryClient.invalidateQueries({ queryKey: workflowRunDetailKey(runId) });
          await queryClient.invalidateQueries({ queryKey: workflowRunsKey(null) });
        }
        if (state.done) {
          relayState.current.delete(runId);
          unregister(runId);
        }
      } catch {
        // Transient local/runtime error — retry on the next tick.
      } finally {
        inFlight.current.delete(runId);
      }
    };

    const tick = () => {
      for (const [runId, registration] of runEntries()) {
        void relayOne(runId, registration);
      }
    };

    tick();
    const timer = setInterval(tick, RELAY_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [runs, queryClient, unregister]);
}
