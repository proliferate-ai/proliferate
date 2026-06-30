import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import type { CloudWorkspaceDetail } from "@proliferate/cloud-sdk";
import { useCloudClient } from "@proliferate/cloud-sdk-react";
import { useCallback } from "react";

import { useAuthToken } from "../../../providers/WebCloudProvider";
import { resolveWebCloudSandboxWorkspaceConnection } from "../../../lib/access/anyharness/cloud-sandbox-runtime";

export function useWebCloudSandboxWorkspaceConnection(
  workspace: CloudWorkspaceDetail | null,
) {
  const { token } = useAuthToken();
  const client = useCloudClient();

  return useCallback(async (workspaceId: string): Promise<AnyHarnessResolvedConnection> => {
    if (!workspace) {
      throw new Error("Cloud runtime unavailable.");
    }
    if (workspace.id !== workspaceId) {
      throw new Error("Requested cloud workspace is not loaded.");
    }
    const runtime = await resolveWebCloudSandboxWorkspaceConnection({
      workspace,
      productToken: token,
      client,
    });
    return {
      runtimeUrl: runtime.runtimeUrl,
      authToken: runtime.authToken,
      anyharnessWorkspaceId: runtime.anyharnessWorkspaceId,
      webSocketAuthTransport: runtime.webSocketAuthTransport,
    };
  }, [client, token, workspace]);
}
