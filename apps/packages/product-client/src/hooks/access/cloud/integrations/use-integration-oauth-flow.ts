import { useQuery } from "@tanstack/react-query";
import {
  getIntegrationOauthFlow,
  type IntegrationOAuthFlowStatus,
} from "@proliferate/cloud-sdk/client/integrations";
import { isTerminalIntegrationOauthFlowStatus } from "#product/lib/domain/cloud/integrations";
import { cloudIntegrationOauthFlowKey } from "#product/hooks/access/cloud/integrations/query-keys";

// Named exception (does not sit on the `cadence` scale): 2s falls strictly
// between `cadence.fastMs` (1s) and `cadence.standardMs` (5s). Snapping down
// to fast would tighten this active-watch poll (forbidden); snapping up to
// standard would more than double the wait while the user has a browser tab
// open mid-OAuth-handoff watching for the flow to resolve, which is not an
// inconsequential loosening. Kept as its own named constant instead of
// force-fitting a token (UX Latency + Transitions ADR §4.7, Rung 6, Q8).
const OAUTH_FLOW_POLL_INTERVAL_MS = 2_000;

/**
 * Poll an integration OAuth flow while the browser handoff is in progress.
 * Polling stops automatically once the flow reaches a terminal status.
 */
export function useIntegrationOauthFlow(flowId: string | null) {
  return useQuery({
    queryKey: cloudIntegrationOauthFlowKey(flowId),
    enabled: flowId !== null,
    queryFn: () => getIntegrationOauthFlow(flowId!),
    refetchInterval: (query) => {
      const status = (query.state.data as IntegrationOAuthFlowStatus | undefined)?.status;
      if (status && isTerminalIntegrationOauthFlowStatus(status)) return false;
      return OAUTH_FLOW_POLL_INTERVAL_MS;
    },
  });
}
