import type { AnyHarnessClientConnection, AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import { resolveRuntimeTargetForWorkspace } from "./runtime-target";

export type AnyHarnessDesktopResolvedConnection = AnyHarnessResolvedConnection & {
  runtimeGeneration?: number;
  runtimeAccessKind?: "direct" | "proliferate-gateway";
};

export async function resolveWorkspaceConnection(
  runtimeUrl: string,
  workspaceId: string,
): Promise<AnyHarnessDesktopResolvedConnection> {
  const target = await resolveRuntimeTargetForWorkspace(runtimeUrl, workspaceId);
  return {
    runtimeUrl: target.baseUrl,
    authToken: target.authToken,
    webSocketAuthTransport: target.webSocketAuthTransport,
    anyharnessWorkspaceId: target.anyharnessWorkspaceId,
    runtimeGeneration: target.runtimeGeneration,
    runtimeAccessKind: target.runtimeAccessKind,
  };
}

/**
 * Plain local-runtime connection with no workspace routing -- for calls (like the
 * cloud->local mirror's repo-root mobility prepare-destination, spec section 2.3
 * mirror step 3) that don't yet have a workspace id to resolve through, since the
 * whole point of the call is to create one. Mirrors
 * `resolveRuntimeTargetForWorkspace`'s local branch (no cloud/target routing, no auth
 * token) without needing a real workspace id to build it.
 */
export function resolveLocalAnyHarnessConnection(runtimeUrl: string): AnyHarnessClientConnection {
  return { runtimeUrl, authToken: undefined };
}
