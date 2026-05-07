import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";

export function createReplayAccessClient(connection: AnyHarnessClientConnection) {
  return getAnyHarnessClient(connection);
}
