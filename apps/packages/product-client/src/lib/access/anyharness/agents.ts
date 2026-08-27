import type { AgentLoginVariant, AnyHarnessRequestOptions } from "@anyharness/sdk";
import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";

export function getAgentLaunchOptions(
  connection: AnyHarnessClientConnection,
  harnessKind: string,
  options?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).agents.getLaunchOptions(harnessKind, options);
}

export function startAgentLoginTerminal(
  connection: AnyHarnessClientConnection,
  harnessKind: string,
  variant?: AgentLoginVariant,
) {
  return getAnyHarnessClient(connection).agents.startLoginTerminal(harnessKind, variant);
}

export function getAgentLoginTerminal(connection: AnyHarnessClientConnection, terminalId: string) {
  return getAnyHarnessClient(connection).agents.getLoginTerminal(terminalId);
}

/**
 * The one-time seat-token handoff (seats v1): the runtime wipes its buffer as
 * it serves this, so the caller holds the only copy — in memory, never logged.
 */
export function claimAgentMintToken(connection: AnyHarnessClientConnection, terminalId: string) {
  return getAnyHarnessClient(connection).agents.claimMintToken(terminalId);
}

export function closeAgentLoginTerminal(connection: AnyHarnessClientConnection, terminalId: string) {
  return getAnyHarnessClient(connection).agents.closeLoginTerminal(terminalId);
}
