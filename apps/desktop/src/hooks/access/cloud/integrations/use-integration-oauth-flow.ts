import { useQuery } from "@tanstack/react-query";
import {
  getIntegrationOauthFlow,
  type IntegrationOAuthFlowStatus,
} from "@proliferate/cloud-sdk/client/integrations";
import { isTerminalIntegrationOauthFlowStatus } from "@/lib/domain/cloud/integrations";
import { cloudIntegrationOauthFlowKey } from "./query-keys";

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
