import { useEffect, useRef } from "react";
import { useAgentAuthState } from "@proliferate/cloud-sdk-react";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { applyAgentAuthState } from "@/lib/access/anyharness/agent-auth";
import { getProliferateApiOrigin } from "@/lib/infra/proliferate-api";
import {
  planLocalAuthStatePush,
  shouldSyncLocalAuthState,
  stampIssuingServerOrigin,
} from "@/lib/domain/agents/local-auth-state";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

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
  const authenticated = authStatus === "authenticated";
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const stateQuery = useAgentAuthState("local", authenticated && cloudEnabled);
  const lastPushedRef = useRef<string | null>(null);

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
      lastPushedFingerprint: lastPushedRef.current,
    });
    if (!plan.shouldPush) {
      return;
    }
    let cancelled = false;
    const stamped = stampIssuingServerOrigin(state, getProliferateApiOrigin());
    applyAgentAuthState({ runtimeUrl }, stamped)
      .then(() => {
        if (!cancelled) {
          lastPushedRef.current = plan.fingerprint;
        }
      })
      .catch((error: unknown) => {
        console.warn("[agent-auth] local state sync push failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, cloudEnabled, runtimeHealthy, runtimeUrl, state]);
}
