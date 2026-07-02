import { useEffect, useMemo, useRef, useState } from "react";
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
 * state. Fingerprints are tracked per runtime (recorded only on push
 * success), so one runtime's push never suppresses or forces another's.
 * A duplicate of an in-flight push is skipped, but the skip is remembered:
 * if the in-flight push then fails, the sync re-evaluates immediately so a
 * retry trigger that fired mid-flight is never consumed by the failure.
 *
 * Observing a runtime in any non-attached state resets its bookkeeping:
 * the fingerprint is dropped (a re-imaged or re-enrolled box comes back with
 * its persisted state.json wiped, so the last push can no longer be assumed
 * delivered) and any in-flight push is orphaned. The next attach therefore
 * always re-pushes; the runtime accepts the redundant equal-revision write.
 *
 * Multi-writer: several Desktops attached to the same runtime all push the
 * same server-rendered document; the runtime's stale-revision guard
 * (`RouteAuthError::StaleStateRevision`, 409) makes concurrent pushes
 * idempotent, so no cross-desktop coordination is needed.
 */

interface InFlightPush {
  fingerprint: string;
  runtimeUrl: string;
  authToken: string | null;
  retryTriggerSuppressed: boolean;
}

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
  const inFlightPushByRuntimeRef = useRef(new Map<string, InFlightPush>());
  // Bumped when a failed push had suppressed a duplicate effect run while it
  // was in flight, so the suppressed trigger re-evaluates instead of being
  // lost (a ref rollback alone re-runs nothing).
  const [failedPushRetryTick, setFailedPushRetryTick] = useState(0);

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
      const runtimeKey = directRuntimeConnectionKey(targetId);
      const snapshot = getDirectRuntimeConnectionSnapshot(targetId);
      if (snapshot.connectionState !== "attached") {
        // A runtime seen non-attached may come back with its persisted
        // state wiped (re-image + re-enrollment keeps the target id), so
        // reset its bookkeeping: the next attach re-pushes unconditionally,
        // and an in-flight push can no longer count as delivered.
        lastPushedByRuntimeRef.current.delete(runtimeKey);
        inFlightPushByRuntimeRef.current.delete(runtimeKey);
        return;
      }
      const runtimeUrl = snapshot.baseUrl?.trim();
      if (!runtimeUrl) {
        return;
      }
      const state = stateQueries[index]?.data;
      // Wait until this runtime's server state has settled before deciding.
      if (state === undefined) {
        return;
      }
      const plan = planLocalAuthStatePush({
        state,
        lastPushedFingerprint: lastPushedByRuntimeRef.current.get(runtimeKey) ?? null,
      });
      if (!plan.shouldPush) {
        return;
      }
      const inFlight = inFlightPushByRuntimeRef.current.get(runtimeKey);
      if (
        inFlight !== undefined
        && inFlight.fingerprint === plan.fingerprint
        && inFlight.runtimeUrl === runtimeUrl
        && inFlight.authToken === snapshot.authToken
      ) {
        // This exact push is already in flight — skip the duplicate, but
        // remember the skip so a failure retries instead of consuming the
        // trigger that fired mid-flight.
        inFlight.retryTriggerSuppressed = true;
        return;
      }
      const attempt: InFlightPush = {
        fingerprint: plan.fingerprint,
        runtimeUrl,
        authToken: snapshot.authToken,
        retryTriggerSuppressed: false,
      };
      inFlightPushByRuntimeRef.current.set(runtimeKey, attempt);
      applyAgentAuthState({ runtimeUrl, authToken: snapshot.authToken }, state).then(
        () => {
          // A superseded or orphaned attempt proves nothing about the
          // runtime's current connection; only the live attempt records.
          if (inFlightPushByRuntimeRef.current.get(runtimeKey) !== attempt) {
            return;
          }
          inFlightPushByRuntimeRef.current.delete(runtimeKey);
          lastPushedByRuntimeRef.current.set(runtimeKey, plan.fingerprint);
        },
        (error: unknown) => {
          console.warn(
            "[agent-auth] direct-runtime state sync push failed",
            { targetId },
            error,
          );
          if (inFlightPushByRuntimeRef.current.get(runtimeKey) !== attempt) {
            return;
          }
          inFlightPushByRuntimeRef.current.delete(runtimeKey);
          if (attempt.retryTriggerSuppressed) {
            setFailedPushRetryTick((tick) => tick + 1);
          }
        },
      );
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
    failedPushRetryTick,
  ]);
}
