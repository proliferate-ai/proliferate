import type { AnyHarnessRequestOptions } from "@anyharness/sdk";
import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import type { WorkspaceSession } from "#product/hooks/access/anyharness/sessions/use-workspace-session-cache";
import type { useWorkspaceBootstrapCache } from "#product/hooks/access/anyharness/workspaces/use-workspace-bootstrap-cache";
import { enterWorkspaceSessionRecovery } from "#product/hooks/workspaces/workflows/workspace-session-recovery-state";
import type {
  MeasurementOperationId,
} from "#product/lib/domain/telemetry/debug-measurement-catalog";
import {
  elapsedMs,
  logLatency,
  recordMeasurementWorkflowStep,
} from "#product/lib/infra/measurement/measurement-port";
import {
  loadSessionsWithBoundedRecovery,
} from "#product/lib/workflows/workspaces/bounded-session-list-recovery";

export type WorkspaceSessionDirectoryResult =
  | { kind: "loaded"; sessions: WorkspaceSession[] }
  | { kind: "failed" }
  | { kind: "stale" };

export async function loadWorkspaceSessionDirectory(
  input: {
    isCurrent: () => boolean;
    forceInitialRefresh?: boolean;
    logicalWorkspaceId: string;
    measurementOperationId: MeasurementOperationId | null;
    requestOptions: AnyHarnessRequestOptions | undefined;
    sessionsStartedAt: number;
    timeoutMs: number;
    workspaceConnection: AnyHarnessResolvedConnection;
    workspaceId: string;
  },
  deps: {
    loadWorkspaceSessions: ReturnType<
      typeof useWorkspaceBootstrapCache
    >["loadWorkspaceSessions"];
  },
): Promise<WorkspaceSessionDirectoryResult> {
  const result = await loadSessionsWithBoundedRecovery({
    isCurrent: input.isCurrent,
    forceInitialRefresh: input.forceInitialRefresh,
    load: (forceRefresh) => deps.loadWorkspaceSessions({
      workspaceConnection: input.workspaceConnection,
      workspaceId: input.workspaceId,
      isCurrent: input.isCurrent,
      requestOptions: input.requestOptions ?? undefined,
      forceRefresh,
      timeoutMs: input.timeoutMs,
    }),
  });
  if (result.kind === "stale") {
    return result;
  }
  if (result.kind === "failed") {
    recordMeasurementWorkflowStep({
      operationId: input.measurementOperationId,
      step: "workspace.bootstrap.sessions",
      startedAt: input.sessionsStartedAt,
      outcome: "error_sanitized",
    });
    logLatency("workspace.select.sessions_loaded", {
      workspaceId: input.workspaceId,
      sessionCount: 0,
      fallback: "bounded_recovery_failed",
    });
    enterWorkspaceSessionRecovery(
      input.workspaceId,
      input.logicalWorkspaceId,
      "session-list-failed",
    );
    return result;
  }

  recordMeasurementWorkflowStep({
    operationId: input.measurementOperationId,
    step: "workspace.bootstrap.sessions",
    startedAt: input.sessionsStartedAt,
    count: result.sessions.length,
  });
  logLatency("workspace.select.sessions_loaded", {
    workspaceId: input.workspaceId,
    sessionCount: result.sessions.length,
    recovered: result.recovered,
    elapsedMs: elapsedMs(input.sessionsStartedAt),
  });
  return { kind: "loaded", sessions: result.sessions };
}
