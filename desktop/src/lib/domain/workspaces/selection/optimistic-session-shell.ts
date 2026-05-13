import type { TranscriptState } from "@anyharness/sdk";
import { resolveWithWorkspaceFallback } from "@/lib/domain/workspaces/selection/workspace-keyed-preferences";

export const OPTIMISTIC_WORKSPACE_SESSION_AGENT_KIND = "";
export const OPTIMISTIC_WORKSPACE_SESSION_TITLE = "Chat";

interface OptimisticSessionCandidateInput {
  explicitInitialSessionId?: string | null;
  hasExplicitInitialSessionId: boolean;
  lastViewedSessionByWorkspace: Record<string, string>;
  materializedWorkspaceId: string;
  visibleChatSessionIdsByWorkspace: Record<string, string[]>;
  workspaceUiKey: string;
}

interface OptimisticSessionPlaceholderLike {
  agentKind: string;
  events: readonly unknown[];
  materializedSessionId: string | null;
  optimisticPrompt?: unknown | null;
  sessionId: string;
  title: string | null;
  transcript: Pick<TranscriptState, "turnOrder">;
  transcriptHydrated: boolean;
}

export function resolveOptimisticWorkspaceSessionId({
  explicitInitialSessionId,
  hasExplicitInitialSessionId,
  lastViewedSessionByWorkspace,
  materializedWorkspaceId,
  visibleChatSessionIdsByWorkspace,
  workspaceUiKey,
}: OptimisticSessionCandidateInput): string | null {
  if (hasExplicitInitialSessionId) {
    return explicitInitialSessionId ?? null;
  }

  const lastViewedSessionId = resolveWithWorkspaceFallback(
    lastViewedSessionByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  ).value ?? null;
  if (lastViewedSessionId) {
    return lastViewedSessionId;
  }

  return resolveWithWorkspaceFallback(
    visibleChatSessionIdsByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  ).value?.[0] ?? null;
}

export function isOptimisticWorkspaceSessionPlaceholder(
  record: OptimisticSessionPlaceholderLike | null | undefined,
): boolean {
  return !!record
    && record.agentKind === OPTIMISTIC_WORKSPACE_SESSION_AGENT_KIND
    && record.title === OPTIMISTIC_WORKSPACE_SESSION_TITLE
    && record.materializedSessionId === record.sessionId
    && !record.transcriptHydrated
    && record.events.length === 0
    && record.transcript.turnOrder.length === 0
    && !record.optimisticPrompt;
}
