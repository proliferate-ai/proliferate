import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import { resolveRuntimeTargetForWorkspace } from "./runtime-target";

export type AnyHarnessDesktopResolvedConnection = AnyHarnessResolvedConnection & {
  runtimeGeneration?: number;
};

export async function resolveWorkspaceConnection(
  runtimeUrl: string,
  workspaceId: string,
): Promise<AnyHarnessDesktopResolvedConnection> {
  const target = await resolveRuntimeTargetForWorkspace(runtimeUrl, workspaceId);
  return {
    runtimeUrl: target.baseUrl,
    authToken: target.authToken,
    anyharnessWorkspaceId: target.anyharnessWorkspaceId,
    runtimeGeneration: target.runtimeGeneration,
  };
}
