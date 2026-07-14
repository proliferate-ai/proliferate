import {
  getLatencyFlowRequestHeaders,
} from "@/lib/infra/measurement/latency-flow";
import type { DesktopRuntimeBridge } from "@proliferate/product-client/host/desktop-bridge";
import { parseTargetWorkspaceSyntheticId } from "@/lib/domain/compute/target-workspace-id";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { getMeasurementRequestOptions } from "@/lib/infra/measurement/debug-measurement-request-options";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import { bootstrapHarnessRuntime } from "@/lib/access/anyharness/runtime-bootstrap";
import { fetchWorkspaceSessionSummaries } from "@/lib/access/anyharness/session-runtime";
import type { WorkspaceSession } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import {
  filterReplacedSessionTombstones,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";

export function buildLatencyRequestOptions(latencyFlowId?: string | null) {
  const headers = getLatencyFlowRequestHeaders(latencyFlowId);
  return headers ? { headers } : undefined;
}

export async function ensureRuntimeReadyForSessions(
  runtime: DesktopRuntimeBridge | null,
): Promise<string> {
  if (!runtime) {
    throw new Error("A local AnyHarness runtime is only available in Desktop.");
  }

  const state = useHarnessConnectionStore.getState();
  if (state.connectionState !== "healthy" || state.runtimeUrl.trim().length === 0) {
    await bootstrapHarnessRuntime(runtime);
  }

  const readyState = useHarnessConnectionStore.getState();
  if (readyState.connectionState !== "healthy" || readyState.runtimeUrl.trim().length === 0) {
    throw new Error(readyState.error || "AnyHarness runtime is still starting. Try again.");
  }

  return readyState.runtimeUrl;
}

export async function resolveRuntimeUrlForWorkspaceSessions(
  workspaceId: string,
  runtime: DesktopRuntimeBridge | null,
): Promise<string> {
  if (parseTargetWorkspaceSyntheticId(workspaceId) || parseCloudWorkspaceSyntheticId(workspaceId)) {
    return useHarnessConnectionStore.getState().runtimeUrl.trim();
  }
  return ensureRuntimeReadyForSessions(runtime);
}

export async function fetchWorkspaceSessions(
  runtimeUrl: string,
  workspaceId: string,
  options?: {
    requestHeaders?: HeadersInit;
    measurementOperationId?: MeasurementOperationId | null;
  },
): Promise<WorkspaceSession[]> {
  const sessions = await fetchWorkspaceSessionSummaries(
    runtimeUrl,
    workspaceId,
    getMeasurementRequestOptions({
      operationId: options?.measurementOperationId,
      category: "session.list",
      headers: options?.requestHeaders,
    }),
  );
  const visibleSessions = filterReplacedSessionTombstones(workspaceId, sessions) ?? [];
  return visibleSessions.map((session) => ({
    ...session,
    workspaceId,
  }));
}
