import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  agentAuthSelectionsRootKey,
  agentAuthStateRootKey,
  useAgentAuthState,
  useAgentGatewayEnrollment,
  useCloudClient,
} from "@proliferate/cloud-sdk-react";
import { ackAgentAuthState } from "@proliferate/cloud-sdk";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  applyAgentAuthState,
  clearAgentAuthState,
} from "#product/lib/access/anyharness/agent-auth";
import { getProliferateApiOrigin } from "#product/lib/infra/proliferate-api";
import {
  planLocalAuthStatePush,
  shouldSyncLocalAuthState,
  stampIssuingServerOrigin,
} from "#product/lib/domain/agents/local-auth-state";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useAgentResourcesCache } from "#product/hooks/access/anyharness/agents/use-agent-resources-cache";
import {
  diagnosticField,
  recordRendererDiagnostic,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import { safeRendererErrorName } from "#product/lib/infra/diagnostics/renderer-diagnostic-values";

/**
 * Poll the enrollment while it has not reached `synced` so the pending→synced
 * transition is actually observed (there is no server push channel). Stops the
 * moment the enrollment is synced.
 *
 * Named exception (does not sit on the `cadence` scale): 10s falls strictly
 * between `cadence.standardMs` (5s) and `cadence.relaxedMs` (15s). Snapping
 * down to standard would tighten (forbidden); snapping up to relaxed would
 * delay the pending→synced transition that gates whether local agent auth is
 * usable by 50% longer. Kept as its own named constant (UX Latency +
 * Transitions ADR §4.7, Rung 6, Q8).
 */
const ENROLLMENT_SYNC_POLL_MS = 10_000;

const ENROLLMENT_SYNCED = "synced";

/**
 * Local-surface agent-auth state writer (the desktop twin of the cloud
 * materializer): fetches the server-rendered state.json document for the
 * local surface and pushes it to the local AnyHarness runtime, which persists
 * it at `<runtime_home>/agent-auth/state.json` for every session launch.
 *
 * Runs on app start (once the state query and the runtime are both ready) and
 * re-runs whenever route selections or API keys mutate — those mutations
 * invalidate the agent-auth state query, so fresh data re-triggers the push.
 * An enrollment reaching `synced` is the same kind of poke (Proof C5): the
 * server re-renders with keys at a newer sequence, and this hook invalidates
 * the state query so the re-pull happens now rather than at the next
 * unrelated mutation.
 *
 * Applied means acknowledged (Proof C1): after the runtime confirms a
 * push/clear, the hook reports the delivered document's (sequence,
 * fingerprint) through `POST /v1/cloud/agent-auth/state/ack` — that stamp is
 * what flips the settings panes from "Applying…" to applied. A failed push
 * records no ack, so the selection stays visibly pending and is retried on
 * the next state change. A push that succeeded while only the ack POST
 * failed is retried ack-only on the next sync pass (pushed and acked
 * fingerprints are tracked separately), so a transient network blip never
 * leaves the server stamp — and the panes — stuck on "Applying…".
 */
export function useLocalAuthStateSync() {
  // The local agent-auth push must NOT be gated on cloud COMPUTE (the old
  // `cloudActive` coupling): the local surface state carries gateway + BYOK
  // routes for LOCAL sessions, which a gateway-enabled, compute-less server
  // still needs. Gate on authenticated + reachable instead (see
  // `shouldSyncLocalAuthState`).
  const { controlPlaneReachable, authStatus } = useCloudAvailabilityState();
  const apiBaseUrl = useProductHost().deployment.apiBaseUrl;
  const authenticated = authStatus === "authenticated";
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const stateQuery = useAgentAuthState("local", authenticated && controlPlaneReachable);
  const cloudClient = useCloudClient();
  const queryClient = useQueryClient();
  const lastPushedRef = useRef<string | null>(null);
  // Tracked SEPARATELY from last-pushed: a push can succeed while its ack
  // POST fails transiently. Subsequent passes then see an unchanged document
  // (no re-push needed) but pushed !== acked, and retry only the ack — the
  // server stamp must not stay "Applying…" forever behind one lost request.
  const lastAckedRef = useRef<string | null>(null);
  const lastScheduledRef = useRef<string | null>(null);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const { invalidateAgentLaunchReadinessResources } = useAgentResourcesCache();

  const state = stateQuery.data;
  const runtimeHealthy = connectionState === "healthy" && runtimeUrl.trim().length > 0;

  // Enrollment-sync poke, client half (Proof C5): C-1's server half bumps the
  // local-surface sequence when an enrollment reaches `synced`, so the next
  // pull renders WITH keys — this half makes that pull happen promptly by
  // invalidating the state query on the observed →synced transition. Polling
  // exists only to observe that transition and stops once synced.
  const [enrollmentPollMs, setEnrollmentPollMs] = useState<number | false>(
    ENROLLMENT_SYNC_POLL_MS,
  );
  const enrollmentQuery = useAgentGatewayEnrollment(authenticated && controlPlaneReachable, {
    refetchInterval: enrollmentPollMs,
  });
  // "none" (a 404 — enrollment row not created yet) counts as an observed
  // NON-synced state, so a fresh signup whose sync completes between polls
  // still triggers the poke (none → synced), while an app that starts
  // already-synced never does.
  const enrollmentSyncStatus = enrollmentQuery.data?.syncStatus
    ?? (enrollmentQuery.isError ? "none" : undefined);
  const lastSyncStatusRef = useRef<string | null>(null);

  useEffect(() => {
    setEnrollmentPollMs(
      enrollmentSyncStatus === ENROLLMENT_SYNCED ? false : ENROLLMENT_SYNC_POLL_MS,
    );
    const previous = lastSyncStatusRef.current;
    if (enrollmentSyncStatus !== undefined) {
      lastSyncStatusRef.current = enrollmentSyncStatus;
    }
    if (
      enrollmentSyncStatus === ENROLLMENT_SYNCED
      && previous !== null
      && previous !== ENROLLMENT_SYNCED
    ) {
      void queryClient.invalidateQueries({ queryKey: agentAuthStateRootKey() });
      void queryClient.invalidateQueries({ queryKey: agentAuthSelectionsRootKey() });
    }
  }, [enrollmentSyncStatus, queryClient]);

  useEffect(() => {
    if (!shouldSyncLocalAuthState({ authenticated, serverReachable: controlPlaneReachable, runtimeHealthy })) {
      return;
    }
    // Wait until the server state has settled before deciding anything.
    if (state === undefined) {
      return;
    }
    const plan = planLocalAuthStatePush({
      state,
      // Treat an enqueued operation as handled so unrelated renders do not
      // enqueue the same document again while an earlier route is in flight.
      lastPushedFingerprint: lastScheduledRef.current,
    });

    // The runtime confirmed the applied document — report the delivery ack
    // so the server's applied-vs-pending truth (and the settings panes)
    // flips to applied. Echo the SERVED document identity: the runtime's
    // accepted sequence is `state.sequence` (a stale lower-sequence push
    // errors out at the runtime), and `state.fingerprint` is the
    // server-computed hash riding the GET /state response — never the local
    // `localAuthStateFingerprint` dedupe key.
    const reportDeliveryAck = async () => {
      if (!(typeof state.fingerprint === "string" && state.fingerprint.length > 0)) {
        return;
      }
      try {
        await ackAgentAuthState(
          "local",
          { sequence: state.sequence, fingerprint: state.fingerprint },
          cloudClient,
        );
        lastAckedRef.current = plan.fingerprint;
        void queryClient.invalidateQueries({ queryKey: agentAuthSelectionsRootKey() });
      } catch (error: unknown) {
        // The runtime HAS the state; only the report failed. pushed !== acked
        // now, so the next sync pass retries the ack without re-pushing.
        recordAgentAuthFailure("delivery_ack_failed", error, state.sequence);
        console.warn("[agent-auth] local state delivery ack failed", error);
      }
    };

    if (plan.action === null) {
      // Nothing to push — but a previously delivered document may still be
      // unacked (transient ack failure). Retry the stamp alone.
      if (
        lastPushedRef.current === plan.fingerprint
        && lastAckedRef.current !== plan.fingerprint
      ) {
        operationQueueRef.current = operationQueueRef.current.then(reportDeliveryAck);
      }
      return;
    }
    lastScheduledRef.current = plan.fingerprint;

    // Serialize route changes. Aborting a superseded fetch does not guarantee
    // that the local runtime stopped processing it; independent PUT/DELETE
    // requests can otherwise land out of order during gateway -> native ->
    // API-key transitions and leave the persisted route stale.
    operationQueueRef.current = operationQueueRef.current.then(async () => {
      try {
        if (plan.action === "clear") {
          await clearAgentAuthState({ runtimeUrl });
        } else {
          await applyAgentAuthState(
            { runtimeUrl },
            stampIssuingServerOrigin(state, getProliferateApiOrigin(apiBaseUrl)),
          );
        }
      } catch (error: unknown) {
        if (lastScheduledRef.current === plan.fingerprint) {
          lastScheduledRef.current = lastPushedRef.current;
        }
        // No ack on failure (Proof C1): the selection stays visibly pending.
        recordAgentAuthFailure(
          "state_push_failed",
          error,
          state.sequence,
          plan.action ?? undefined,
        );
        console.warn("[agent-auth] local state sync push failed", error);
        return;
      }

      lastPushedRef.current = plan.fingerprint;

      await reportDeliveryAck();

      try {
        await invalidateAgentLaunchReadinessResources(runtimeUrl);
      } catch (error: unknown) {
        recordAgentAuthFailure("launch_resource_refresh_failed", error, state.sequence);
        console.warn("[agent-auth] local launch resource refresh failed", error);
      }
    });
  }, [
    apiBaseUrl,
    authenticated,
    cloudClient,
    controlPlaneReachable,
    invalidateAgentLaunchReadinessResources,
    queryClient,
    runtimeHealthy,
    runtimeUrl,
    state,
  ]);
}

function recordAgentAuthFailure(
  stage:
    | "delivery_ack_failed"
    | "state_push_failed"
    | "launch_resource_refresh_failed",
  error: unknown,
  sequence: number,
  action?: string,
): void {
  recordRendererDiagnostic({
    name: `renderer.agent_auth.${stage}`,
    severity: "warn",
    kind: "message",
    privacy: "operational",
    fields: {
      sequence: diagnosticField(sequence, "operational"),
      error_name: diagnosticField(safeRendererErrorName(error), "operational"),
      ...(action === undefined
        ? {}
        : { action: diagnosticField(action, "operational") }),
    },
    errorClassification: stage,
  });
}
