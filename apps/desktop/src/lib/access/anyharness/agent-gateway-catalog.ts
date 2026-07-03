import type { AnyHarnessRequestOptions } from "@anyharness/sdk";
import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";

export function getAgentGatewayModels(
  connection: AnyHarnessClientConnection,
  kind: string,
  options?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).agentGatewayCatalog.getGatewayModels(kind, options);
}

export function refreshAgentGatewayModels(
  connection: AnyHarnessClientConnection,
  kind: string,
  options?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).agentGatewayCatalog.refreshGatewayModels(kind, options);
}
