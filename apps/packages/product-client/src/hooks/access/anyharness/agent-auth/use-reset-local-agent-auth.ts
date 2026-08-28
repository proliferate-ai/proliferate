import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { agentAuthStateRootKey } from "@proliferate/cloud-sdk-react";
import { clearAgentAuthState } from "#product/lib/access/anyharness/agent-auth";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useLocalAuthDeliveryStore } from "#product/stores/agents/local-auth-delivery-store";

/**
 * The ONE explicit recovery for a foreign-lineage refusal (founder-ruled):
 * "reset this machine's agent auth". Clears the LOCAL runtime's persisted
 * agent-auth state (`DELETE /v1/agent-auth/state` — the reset door that
 * already exists; clearing removes the persisted document, so the next push
 * adopts the new lineage cleanly), then re-triggers the courier by
 * invalidating the agent-auth state query. No new server route, no new
 * runtime route, no epochs.
 */
export function useResetLocalAgentAuth(): {
  reset: () => Promise<void>;
  resetting: boolean;
} {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const queryClient = useQueryClient();
  const [resetting, setResetting] = useState(false);

  const reset = useCallback(async () => {
    setResetting(true);
    try {
      await clearAgentAuthState({ runtimeUrl });
      // The refusal is resolved the moment the persisted document is gone;
      // clearing the recorded failure now (rather than waiting for the
      // re-push to succeed) keeps the banner honest — the machine no longer
      // holds foreign state.
      useLocalAuthDeliveryStore.getState().clearLastPushFailure();
      // Re-trigger the sync: fresh state data re-runs the courier's push
      // effect, and with no persisted document the push adopts.
      await queryClient.invalidateQueries({ queryKey: agentAuthStateRootKey() });
    } finally {
      setResetting(false);
    }
  }, [queryClient, runtimeUrl]);

  return { reset, resetting };
}
