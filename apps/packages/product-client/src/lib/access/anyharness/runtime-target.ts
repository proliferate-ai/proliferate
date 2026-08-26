import type { CloudAgentKind } from "@proliferate/cloud-sdk/types";
import type { TerminalWebSocketAuthTransport } from "@anyharness/sdk";
import {
  type CloudSandboxGatewayUrlSource,
} from "#product/lib/access/cloud/cloud-sandbox-gateway";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";

export interface RuntimeTarget {
  location: "local" | "cloud";
  baseUrl: string;
  authToken?: string;
  webSocketAuthTransport?: TerminalWebSocketAuthTransport;
  anyharnessWorkspaceId: string;
  runtimeGeneration: number;
  runtimeAccessKind?: "direct" | "proliferate-gateway";
  cloudWorkspaceId?: string;
  targetId?: string;
  allowedAgentKinds?: CloudAgentKind[];
  readyAgentKinds?: CloudAgentKind[];
}

export async function resolveRuntimeTargetForWorkspace(
  runtimeUrl: string,
  workspaceId: string,
  _cloudClient: CloudSandboxGatewayUrlSource | null,
): Promise<RuntimeTarget> {
  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
  if (cloudWorkspaceId) {
    // The cloud workspace stack is deleted; a synthetic cloud id can only be
    // a stale remnant with no runtime behind it.
    throw new Error("Cloud workspaces are no longer available.");
  }

  return {
    location: "local",
    baseUrl: runtimeUrl,
    anyharnessWorkspaceId: workspaceId,
    runtimeGeneration: 0,
  };
}
