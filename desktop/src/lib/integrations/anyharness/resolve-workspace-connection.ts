import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import { resolveRuntimeTargetForWorkspace } from "./runtime-target";

export async function resolveWorkspaceConnection(
  runtimeUrl: string,
  workspaceId: string,
): Promise<AnyHarnessResolvedConnection> {
  const target = await resolveRuntimeTargetForWorkspace(runtimeUrl, workspaceId);
  return {
    runtimeUrl: target.baseUrl,
    authToken: target.authToken,
    anyharnessWorkspaceId: target.anyharnessWorkspaceId,
  };
}
