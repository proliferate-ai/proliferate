import type {
  AgentAuthStateDocument,
  AnyHarnessRequestOptions,
} from "@anyharness/sdk";
import {
  getAnyHarnessClient,
  type AnyHarnessClientConnection,
} from "@anyharness/sdk-react";

export function applyAgentAuthState(
  connection: AnyHarnessClientConnection,
  state: AgentAuthStateDocument,
  options?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).agentAuth.applyState(state, options);
}

export function clearAgentAuthState(
  connection: AnyHarnessClientConnection,
  options?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).agentAuth.clearState(options);
}
