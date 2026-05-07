import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";

export function createLocalAutomationRuntimeClient(connection: AnyHarnessClientConnection) {
  return getAnyHarnessClient(connection);
}
