import type { ConnectOAuthConnectorResult } from "@/lib/domain/mcp/types";
import { openExternal } from "@/lib/access/tauri/shell";
import {
  cancelCloudMcpOAuthFlow,
  getCloudMcpOAuthFlowStatus,
  startCloudMcpOAuthFlow,
} from "@proliferate/cloud-sdk/client/mcp_oauth";

const pendingCloudOAuthFlows = new Map<string, string>();

export async function cancelOAuthConnectorConnect(connectionId: string): Promise<void> {
  const flowId = pendingCloudOAuthFlows.get(connectionId);
  if (flowId) {
    await cancelCloudMcpOAuthFlow(flowId);
    clearPendingCloudOAuthFlowByFlowId(flowId);
  }
}

export async function runCloudOAuthFlow(
  connectionId: string,
  pendingAliasConnectionId?: string,
): Promise<ConnectOAuthConnectorResult> {
  const started = await startCloudMcpOAuthFlow(connectionId);
  pendingCloudOAuthFlows.set(connectionId, started.flowId);
  if (pendingAliasConnectionId) {
    pendingCloudOAuthFlows.set(pendingAliasConnectionId, started.flowId);
  }
  await openExternal(started.authorizationUrl);
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const status = await getCloudMcpOAuthFlowStatus(started.flowId);
    if (status.status === "completed") {
      clearPendingCloudOAuthFlow(connectionId);
      if (pendingAliasConnectionId) {
        clearPendingCloudOAuthFlow(pendingAliasConnectionId);
      }
      return { kind: "completed" };
    }
    if (status.status === "cancelled") {
      clearPendingCloudOAuthFlow(connectionId);
      if (pendingAliasConnectionId) {
        clearPendingCloudOAuthFlow(pendingAliasConnectionId);
      }
      return { kind: "canceled" };
    }
    if (status.status === "failed" || status.status === "expired") {
      clearPendingCloudOAuthFlow(connectionId);
      if (pendingAliasConnectionId) {
        clearPendingCloudOAuthFlow(pendingAliasConnectionId);
      }
      throw new Error("Couldn't complete OAuth for this connector.");
    }
  }
  await cancelCloudMcpOAuthFlow(started.flowId).catch(() => undefined);
  clearPendingCloudOAuthFlow(connectionId);
  if (pendingAliasConnectionId) {
    clearPendingCloudOAuthFlow(pendingAliasConnectionId);
  }
  throw new Error("OAuth authorization timed out.");
}

function clearPendingCloudOAuthFlow(connectionId: string): void {
  pendingCloudOAuthFlows.delete(connectionId);
}

function clearPendingCloudOAuthFlowByFlowId(flowId: string): void {
  for (const [connectionId, pendingFlowId] of pendingCloudOAuthFlows) {
    if (pendingFlowId === flowId) {
      pendingCloudOAuthFlows.delete(connectionId);
    }
  }
}
