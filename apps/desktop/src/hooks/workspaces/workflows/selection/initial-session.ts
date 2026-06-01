import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";
import { writeChatShellIntentForSession } from "@/hooks/workspaces/workflows/tabs/workspace-shell-intent-writer";
import { isPendingWorkspaceUiKey } from "@/lib/domain/workspaces/creation/pending-entry";
import {
  OPTIMISTIC_WORKSPACE_SESSION_AGENT_KIND,
  OPTIMISTIC_WORKSPACE_SESSION_TITLE,
  resolveOptimisticWorkspaceSessionId,
} from "@/lib/domain/workspaces/selection/optimistic-session-shell";

export interface InitialSessionRecordDeps {
  createEmptySessionRecord: (
    sessionId: string,
    agentKind: string,
    config?: {
      materializedSessionId?: string | null;
      sessionRelationship?: { kind: "root" };
      title?: string | null;
      workspaceId?: string | null;
    },
  ) => SessionRuntimeRecord;
  getSessionRecord: (sessionId: string) => SessionRuntimeRecord | null;
  logLatency: (name: string, data?: Record<string, unknown>) => void;
  patchSessionRecord: (sessionId: string, patch: Partial<SessionRuntimeRecord>) => void;
  putSessionRecord: (record: SessionRuntimeRecord) => void;
  writeChatShellIntentForSession: typeof writeChatShellIntentForSession;
}

export function resolveInitialActiveSessionId(
  input: {
    workspaceId: string;
    workspaceUiKey: string;
    workspaceUiKeys: readonly string[];
    options: {
      initialActiveSessionId?: string | null;
      preservePending?: boolean;
    } | undefined;
    workspaceUiState: {
      lastViewedSessionByWorkspace: Record<string, string>;
      visibleChatSessionIdsByWorkspace: Record<string, string[]>;
    };
  },
  deps: Pick<InitialSessionRecordDeps, "getSessionRecord" | "logLatency">,
): string | null {
  const candidate = resolveOptimisticWorkspaceSessionId({
    explicitInitialSessionId: input.options?.initialActiveSessionId,
    hasExplicitInitialSessionId: !!input.options && "initialActiveSessionId" in input.options,
    lastViewedSessionByWorkspace: input.workspaceUiState.lastViewedSessionByWorkspace,
    materializedWorkspaceId: input.workspaceId,
    visibleChatSessionIdsByWorkspace: input.workspaceUiState.visibleChatSessionIdsByWorkspace,
    workspaceUiKey: input.workspaceUiKey,
    workspaceUiKeys: input.workspaceUiKeys,
  });
  if (!candidate) {
    return null;
  }

  const cachedSlot = deps.getSessionRecord(candidate);
  if (!cachedSlot?.workspaceId || cachedSlot.workspaceId === input.workspaceId) {
    return candidate;
  }

  const shouldPreservePendingProjection =
    input.options?.preservePending === true
    && isTransientClientSessionId(candidate)
    && !cachedSlot.materializedSessionId
    && isPendingWorkspaceUiKey(cachedSlot.workspaceId);
  if (shouldPreservePendingProjection) {
    deps.logLatency("workspace.select.projected_initial_session_preserved", {
      workspaceId: input.workspaceId,
      workspaceUiKey: input.workspaceUiKey,
      sessionId: candidate,
      existingWorkspaceId: cachedSlot.workspaceId,
      reason: "preserve_pending_projection",
    });
    return candidate;
  }

  return null;
}

export function prepareOptimisticWorkspaceSessionShell(
  input: {
    sessionId: string | null;
    workspaceId: string;
    workspaceUiKey: string;
  },
  deps: InitialSessionRecordDeps,
): void {
  if (!input.sessionId) {
    return;
  }

  const existing = deps.getSessionRecord(input.sessionId);
  if (!existing) {
    deps.putSessionRecord(deps.createEmptySessionRecord(
      input.sessionId,
      OPTIMISTIC_WORKSPACE_SESSION_AGENT_KIND,
      {
        materializedSessionId: input.sessionId,
        sessionRelationship: { kind: "root" },
        title: OPTIMISTIC_WORKSPACE_SESSION_TITLE,
        workspaceId: input.workspaceId,
      },
    ));
  } else if (!existing.materializedSessionId && isTransientClientSessionId(input.sessionId)) {
    if (!existing.workspaceId) {
      deps.patchSessionRecord(input.sessionId, { workspaceId: input.workspaceId });
    }
    deps.logLatency("workspace.select.projected_session_preserved", {
      workspaceId: input.workspaceId,
      workspaceUiKey: input.workspaceUiKey,
      sessionId: input.sessionId,
      existingWorkspaceId: existing.workspaceId ?? null,
      reason: "transient_unmaterialized_session",
    });
  } else if (!existing.workspaceId || !existing.materializedSessionId) {
    deps.patchSessionRecord(input.sessionId, {
      materializedSessionId: existing.materializedSessionId ?? input.sessionId,
      workspaceId: existing.workspaceId ?? input.workspaceId,
    });
  }

  deps.writeChatShellIntentForSession({
    workspaceId: input.workspaceId,
    shellWorkspaceId: input.workspaceUiKey,
    sessionId: input.sessionId,
    invalidateSessionIntent: false,
  });
  deps.logLatency("workspace.select.optimistic_session_shell", {
    workspaceId: input.workspaceId,
    workspaceUiKey: input.workspaceUiKey,
    sessionId: input.sessionId,
    createdRecord: !existing,
  });
}

function isTransientClientSessionId(sessionId: string): boolean {
  return sessionId.startsWith("client-session:")
    || sessionId.startsWith("pending-session:");
}
