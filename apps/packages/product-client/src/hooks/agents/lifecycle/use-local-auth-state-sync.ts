import { useEffect, useRef } from "react";
import { useAgentAuthState } from "@proliferate/cloud-sdk-react";
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

/**
 * Local-surface agent-auth state writer (the desktop twin of the cloud
 * materializer): fetches the server-rendered state.json document for the
 * local surface and pushes it to the local AnyHarness runtime, which persists
 * it at `<runtime_home>/agent-auth/state.json` for every session launch.
 *
 * Runs on app start (once the state query and the runtime are both ready) and
 * re-runs whenever route selections or API keys mutate — those mutations
 * invalidate the agent-auth state query, so fresh data re-triggers the push.
 *
 * Fire-and-forget: push failures are logged and retried on the next state
 * change — the runtime keeps launching against its last persisted state.
 */
export function useLocalAuthStateSync() {
  // The local agent-auth push must NOT be gated on cloud COMPUTE (the old
  // `cloudActive` coupling): the local surface state carries gateway + BYOK
  // routes for LOCAL sessions, which a gateway-enabled, compute-less server
  // still needs. Gate on authenticated + reachable instead (see
  // `shouldSyncLocalAuthState`).
  const { cloudEnabled, authStatus } = useCloudAvailabilityState();
  const apiBaseUrl = useProductHost().deployment.apiBaseUrl;
  const authenticated = authStatus === "authenticated";
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const stateQuery = useAgentAuthState("local", authenticated && cloudEnabled);
  const lastPushedRef = useRef<string | null>(null);
  const lastScheduledRef = useRef<string | null>(null);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const { invalidateAgentLaunchReadinessResources } = useAgentResourcesCache();

  const state = stateQuery.data;
  const runtimeHealthy = connectionState === "healthy" && runtimeUrl.trim().length > 0;

  useEffect(() => {
    if (!shouldSyncLocalAuthState({ authenticated, serverReachable: cloudEnabled, runtimeHealthy })) {
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
    if (plan.action === null) {
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
        console.warn("[agent-auth] local state sync push failed", error);
        return;
      }

      lastPushedRef.current = plan.fingerprint;
      try {
        await invalidateAgentLaunchReadinessResources(runtimeUrl);
      } catch (error: unknown) {
        console.warn("[agent-auth] local launch resource refresh failed", error);
      }
    });
  }, [
    apiBaseUrl,
    authenticated,
    cloudEnabled,
    invalidateAgentLaunchReadinessResources,
    runtimeHealthy,
    runtimeUrl,
    state,
  ]);
}
