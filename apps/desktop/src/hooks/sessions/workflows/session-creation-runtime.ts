import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { parseTargetWorkspaceSyntheticId } from "@/lib/domain/compute/target-workspace-id";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import {
  findClientSessionIdByMaterializedSessionId,
  getMaterializedSessionId,
  getSessionRecords,
  isPendingSessionId,
  patchSessionRecord,
} from "@/stores/sessions/session-records";
import {
  closeSessionStreamHandle,
  flushAllSessionStreamHandles,
  getSessionStreamHandle,
} from "@/lib/access/anyharness/session-stream-handles";
import { bootstrapHarnessRuntime } from "@/lib/access/anyharness/runtime-bootstrap";
import type {
  FlushAwareSessionStreamHandle,
  SessionStreamPruningDeps,
} from "@/lib/workflows/sessions/session-runtime";

export const sessionStreamPruningDeps: SessionStreamPruningDeps = {
  getSessionRecords,
  getSessionStreamHandle: (sessionId: string) =>
    getSessionStreamHandle(sessionId) as FlushAwareSessionStreamHandle | null,
  closeSessionStreamHandle: (
    sessionId: string,
    handle: FlushAwareSessionStreamHandle,
  ) => {
    closeSessionStreamHandle(sessionId, handle);
  },
  flushAllSessionStreamHandles,
  getMaterializedSessionId,
  findClientSessionIdByMaterializedSessionId,
  patchSessionStreamConnectionState: (
    clientSessionId: string,
    streamConnectionState: "disconnected",
  ) => {
    patchSessionRecord(clientSessionId, { streamConnectionState });
  },
  isPendingSessionId,
};

export async function ensureRuntimeReadyForSessions(): Promise<string> {
  const state = useHarnessConnectionStore.getState();
  if (state.connectionState !== "healthy" || state.runtimeUrl.trim().length === 0) {
    await bootstrapHarnessRuntime();
  }

  const readyState = useHarnessConnectionStore.getState();
  if (readyState.connectionState !== "healthy" || readyState.runtimeUrl.trim().length === 0) {
    throw new Error(readyState.error || "AnyHarness runtime is still starting. Try again.");
  }

  return readyState.runtimeUrl;
}

export async function resolveDesktopRuntimeUrlForWorkspace(workspaceId: string): Promise<string> {
  if (parseTargetWorkspaceSyntheticId(workspaceId) || parseCloudWorkspaceSyntheticId(workspaceId)) {
    const runtimeUrl = useHarnessConnectionStore.getState().runtimeUrl.trim();
    if (!runtimeUrl) {
      throw new Error("AnyHarness runtime URL is not available yet.");
    }
    return runtimeUrl;
  }
  return ensureRuntimeReadyForSessions();
}
