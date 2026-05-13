import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";

export function getAgentLaunchOptions(
  connection: AnyHarnessClientConnection,
  workspaceId?: string | null,
) {
  return getAnyHarnessClient(connection).agents.getLaunchOptions(workspaceId);
}
