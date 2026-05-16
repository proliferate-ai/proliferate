import type { TranscriptState } from "@anyharness/sdk";

export const OPTIMISTIC_WORKSPACE_SESSION_AGENT_KIND = "";
export const OPTIMISTIC_WORKSPACE_SESSION_TITLE = "Chat";

interface OptimisticSessionCandidateInput {
  explicitInitialSessionId?: string | null;
  hasExplicitInitialSessionId: boolean;
  lastViewedSessionByWorkspace: Record<string, string>;
  materializedWorkspaceId: string;
  visibleChatSessionIdsByWorkspace: Record<string, string[]>;
  workspaceUiKey: string;
  workspaceUiKeys?: readonly string[];
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
  workspaceUiKeys,
}: OptimisticSessionCandidateInput): string | null {
  if (hasExplicitInitialSessionId) {
    return explicitInitialSessionId ?? null;
  }

  const lookupKeys = uniqueStrings([...(workspaceUiKeys ?? [workspaceUiKey]), materializedWorkspaceId]);
  const lastViewedSessionId = lookupFirst(lastViewedSessionByWorkspace, lookupKeys) ?? null;
  if (lastViewedSessionId) {
    return lastViewedSessionId;
  }

  return lookupFirst(visibleChatSessionIdsByWorkspace, lookupKeys)?.[0] ?? null;
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

function lookupFirst<T>(record: Record<string, T>, keys: readonly string[]): T | undefined {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (value && !result.includes(value)) {
      result.push(value);
    }
  }
  return result;
}
