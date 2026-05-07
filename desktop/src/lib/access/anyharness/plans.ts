import { getAnyHarnessClient, type AnyHarnessResolvedConnection } from "@anyharness/sdk-react";

export function getWorkspacePlan(
  connection: AnyHarnessResolvedConnection,
  planId: string,
) {
  return getAnyHarnessClient(connection).plans.get(
    connection.anyharnessWorkspaceId,
    planId,
  );
}
