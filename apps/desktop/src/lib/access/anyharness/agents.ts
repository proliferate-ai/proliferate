import type { AnyHarnessRequestOptions } from "@anyharness/sdk";
import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";

export function getAgentLaunchOptions(
  connection: AnyHarnessClientConnection,
  workspaceId?: string | null,
  options?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).agents.getLaunchOptions(workspaceId, options);
}
