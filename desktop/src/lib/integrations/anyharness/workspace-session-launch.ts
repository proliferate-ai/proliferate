import { getAnyHarnessClient } from "@anyharness/sdk-react";
import type { WorkspaceSessionLaunchCatalog } from "@anyharness/sdk";
import { resolveWorkspaceConnection } from "./resolve-workspace-connection";

export async function fetchWorkspaceSessionLaunchCatalog(
  runtimeUrl: string,
  workspaceId: string,
): Promise<WorkspaceSessionLaunchCatalog> {
  const connection = await resolveWorkspaceConnection(runtimeUrl, workspaceId);
  return getAnyHarnessClient(connection).workspaces.getSessionLaunchCatalog(
    connection.anyharnessWorkspaceId,
  );
}
