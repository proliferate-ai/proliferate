import type { AnyHarnessRequestOptions } from "@anyharness/sdk";
import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";

export function getAgentLaunchOptions(
  connection: AnyHarnessClientConnection,
  harnessKind: string,
  options?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).agents.getLaunchOptions(harnessKind, options);
}
