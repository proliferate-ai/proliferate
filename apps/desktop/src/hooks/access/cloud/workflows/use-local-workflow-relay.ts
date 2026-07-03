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
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import {
  useWorkflowRelayStore,
  type RelayRunRegistration,
} from "@/stores/workflows/workflow-relay-store";
import { workflowRunDetailKey, workflowRunsKey } from "./query-keys";

const RELAY_POLL_INTERVAL_MS = 2000;
const LOCAL_TARGET_MODE = "local";
const NON_TERMINAL_DELIVERED = new Set(["delivered", "running", "waiting_approval"]);

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
          if (
            run.targetMode === LOCAL_TARGET_MODE
            && NON_TERMINAL_DELIVERED.has(run.status)
            && run.anyharnessWorkspaceId
          ) {
            relayState.current.set(run.id, {
              ...initialRelayState(),
              // The server already advanced past delivery, so `running` is reported.
              reportedRunning: run.status !== "delivered",
            });
            register(run.id, {
              workspaceId: run.anyharnessWorkspaceId,
              runtimeUrl,
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
        const { reports, state } = planRelayReports(prev, view);
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
