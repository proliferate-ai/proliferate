import { useEffect, useMemo, useRef } from "react";
import { useAgentAuthStates } from "@proliferate/cloud-sdk-react";
import { useCloudTargets } from "@/hooks/access/cloud/targets/use-cloud-targets";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { applyAgentAuthState } from "@/lib/access/anyharness/agent-auth";
import { planLocalAuthStatePush } from "@/lib/domain/agents/local-auth-state";
import {
  directAuthSyncTargetIds,
  directRuntimeConnectionKey,
} from "@/lib/domain/compute/direct-runtime";
import {
  getDirectRuntimeConnectionSnapshot,
  useDirectRuntimeConnectionStore,
} from "@/stores/compute/direct-runtime-connection-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

/**
 * Direct-runtime agent-auth state writer (the desktop twin of the cloud
 * materializer), generalized from the loopback-only local writer: one sync
 * instance per direct runtime — the loopback runtime (targetId null) plus
 * every enrolled ssh target. Per runtime, it fetches the server-rendered
 * state.json document (per-target overrides over inherited defaults) and
 * pushes it to that runtime's AnyHarness, which persists it at
 * `<runtime_home>/agent-auth/state.json` for every session launch.
 *
 * Runs on app start (once the state query and a runtime are both ready) and
 * re-runs whenever route selections or API keys mutate — those mutations
 * invalidate the agent-auth state queries, so fresh data re-triggers pushes.
 * Each push is gated on its runtime being attached; documents fetched while
 * a runtime is unreachable are simply delivered on the next attach.
 *
 * Fire-and-forget: push failures are logged and retried on the next state or
 * attach change — the runtime keeps launching against its last persisted
 * state. Fingerprints are tracked per runtime, so one runtime's push never
 * suppresses or forces another's.
 *
 * Multi-writer: several Desktops attached to the same runtime all push the
 * same server-rendered document; the runtime's stale-revision guard
 * (`RouteAuthError::StaleStateRevision`, 409) makes concurrent pushes
 * idempotent, so no cross-desktop coordination is needed.
 */
export function useDirectAuthStateSync() {
  const { cloudActive } = useCloudAvailabilityState();
  const targetsQuery = useCloudTargets(cloudActive);
  const targetIds = useMemo(
    () => directAuthSyncTargetIds(targetsQuery.data),
    [targetsQuery.data],
  );
  const stateQueries = useAgentAuthStates("local", targetIds, cloudActive);
  // Subscribed only to re-render when a runtime attaches/detaches; the effect
  // reads connection snapshots imperatively through the store helper.
  const remoteConnections = useDirectRuntimeConnectionStore(
    (state) => state.connectionsByKey,
  );
  const loopbackRuntimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const loopbackConnectionState = useHarnessConnectionStore(
    (state) => state.connectionState,
  );
  const lastPushedByRuntimeRef = useRef(new Map<string, string>());

  // Fixed-length proxy for the per-runtime query results (a variable-length
  // dependency array is not legal React).
  const statesKey = stateQueries
    .map((query) => (query.data === undefined ? "-" : query.dataUpdatedAt))
    .join("|");

  useEffect(() => {
    if (!cloudActive) {
      return;
    }
    targetIds.forEach((targetId, index) => {
      const state = stateQueries[index]?.data;
      // Wait until this runtime's server state has settled before deciding.
      if (state === undefined) {
        return;
      }
      const snapshot = getDirectRuntimeConnectionSnapshot(targetId);
      if (snapshot.connectionState !== "attached") {
        return;
      }
      const runtimeUrl = snapshot.baseUrl?.trim();
      if (!runtimeUrl) {
        return;
      }
      const runtimeKey = directRuntimeConnectionKey(targetId);
      const plan = planLocalAuthStatePush({
        state,
        lastPushedFingerprint: lastPushedByRuntimeRef.current.get(runtimeKey) ?? null,
      });
      if (!plan.shouldPush) {
        return;
      }
      // Record the fingerprint before the push settles so effect re-runs
      // (attach events, unrelated runtimes changing) do not double-push an
      // in-flight document; roll back on failure so the next state or attach
      // change retries.
      lastPushedByRuntimeRef.current.set(runtimeKey, plan.fingerprint);
      applyAgentAuthState({ runtimeUrl, authToken: snapshot.authToken }, state)
        .catch((error: unknown) => {
          if (lastPushedByRuntimeRef.current.get(runtimeKey) === plan.fingerprint) {
            lastPushedByRuntimeRef.current.delete(runtimeKey);
          }
          console.warn(
            "[agent-auth] direct-runtime state sync push failed",
            { targetId },
            error,
          );
        });
    });
    // stateQueries is intentionally read without being a dependency:
    // statesKey re-runs the effect whenever any runtime's document changes.
  }, [
    cloudActive,
    targetIds,
    statesKey,
    remoteConnections,
    loopbackRuntimeUrl,
    loopbackConnectionState,
  ]);
}
