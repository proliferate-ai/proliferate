import { getAnyHarnessClient, type AnyHarnessResolvedConnection } from "@anyharness/sdk-react";

export function createSessionDebugClient(connection: AnyHarnessResolvedConnection) {
  return getAnyHarnessClient(connection);
}
