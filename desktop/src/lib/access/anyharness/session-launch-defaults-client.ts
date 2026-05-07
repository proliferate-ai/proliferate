import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";

export function createSessionLaunchDefaultsClient(connection: AnyHarnessClientConnection) {
  return getAnyHarnessClient(connection);
}
