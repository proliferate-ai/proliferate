import type { SessionStreamHandle } from "@anyharness/sdk";
import { clearSessionReconnectTimer } from "#product/lib/workflows/sessions/session-reconnect-state";
import {
  diagnosticField,
  recordRendererDiagnostic,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import { safeRendererErrorName } from "#product/lib/infra/diagnostics/renderer-diagnostic-values";

export interface ManagedSessionStreamHandle extends SessionStreamHandle {
  flushPendingEvents?: () => void;
}

interface SessionStreamHandleEntry {
  sessionId: string;
  workspaceId: string | null;
  runtimeUrl: string | null;
  handle: ManagedSessionStreamHandle;
}

const registry = new Map<string, SessionStreamHandleEntry>();

export function setSessionStreamHandle(input: {
  sessionId: string;
  workspaceId?: string | null;
  runtimeUrl?: string | null;
  handle: ManagedSessionStreamHandle;
}): void {
  const existing = registry.get(input.sessionId);
  if (existing?.handle === input.handle) {
    return;
  }
  if (existing) {
    flushAndCloseHandle(input.sessionId, existing.handle);
  }
  registry.set(input.sessionId, {
    sessionId: input.sessionId,
    workspaceId: input.workspaceId ?? null,
    runtimeUrl: input.runtimeUrl ?? null,
    handle: input.handle,
  });
}

export function getSessionStreamHandle(
  sessionId: string,
): ManagedSessionStreamHandle | null {
  return registry.get(sessionId)?.handle ?? null;
}

export function isCurrentSessionStreamHandle(
  sessionId: string,
  handle: SessionStreamHandle,
): boolean {
  return registry.get(sessionId)?.handle === handle;
}

export function clearSessionStreamHandle(
  sessionId: string,
  expectedHandle?: SessionStreamHandle | null,
): void {
  const entry = registry.get(sessionId);
  if (!entry || (expectedHandle && entry.handle !== expectedHandle)) {
    return;
  }
  registry.delete(sessionId);
  clearSessionReconnectTimer(sessionId);
}

export function closeSessionStreamHandle(
  sessionId: string,
  expectedHandle?: SessionStreamHandle | null,
): boolean {
  const entry = registry.get(sessionId);
  if (!entry || (expectedHandle && entry.handle !== expectedHandle)) {
    return false;
  }
  flushAndCloseHandle(sessionId, entry.handle);
  registry.delete(sessionId);
  clearSessionReconnectTimer(sessionId);
  return true;
}

export function closeWorkspaceSessionStreamHandles(workspaceId: string): string[] {
  const closedSessionIds: string[] = [];
  for (const [sessionId, entry] of [...registry.entries()]) {
    if (entry.workspaceId !== workspaceId) {
      continue;
    }
    flushAndCloseHandle(sessionId, entry.handle);
    registry.delete(sessionId);
    clearSessionReconnectTimer(sessionId);
    closedSessionIds.push(sessionId);
  }
  return closedSessionIds;
}

export function closeAllSessionStreamHandles(): string[] {
  const closedSessionIds = [...registry.keys()];
  for (const [sessionId, entry] of [...registry.entries()]) {
    flushAndCloseHandle(sessionId, entry.handle);
    registry.delete(sessionId);
    clearSessionReconnectTimer(sessionId);
  }
  return closedSessionIds;
}

export function flushAllSessionStreamHandles(): void {
  for (const entry of registry.values()) {
    entry.handle.flushPendingEvents?.();
  }
}

export function sessionIdsWithStreamHandles(): string[] {
  return [...registry.keys()];
}

export function resetSessionStreamHandlesForTest(): void {
  registry.clear();
}

function flushAndCloseHandle(sessionId: string, handle: ManagedSessionStreamHandle): void {
  try {
    handle.flushPendingEvents?.();
  } catch (error) {
    recordSessionStreamFailure("flush_failed", sessionId, error);
    console.error("Failed to flush session stream before close", { sessionId, error });
  }
  try {
    handle.close();
  } catch (error) {
    recordSessionStreamFailure("close_failed", sessionId, error);
    console.error("Failed to close session stream", { sessionId, error });
  }
}

function recordSessionStreamFailure(
  stage: "flush_failed" | "close_failed",
  sessionId: string,
  error: unknown,
): void {
  recordRendererDiagnostic({
    name: `renderer.session_stream.${stage}`,
    severity: "error",
    kind: "transport",
    privacy: "operational",
    correlation: { sessionId },
    fields: {
      error_name: diagnosticField(safeRendererErrorName(error), "operational"),
    },
    errorClassification: `session_stream_${stage}`,
  });
}
