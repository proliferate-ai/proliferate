import type { SessionDirectoryEntry } from "@/stores/sessions/session-types";
import { resolveSessionViewState } from "@/lib/domain/sessions/activity";

export const MAX_HOT_SESSION_STREAMS = 12;

export type HotSessionReason =
  | "selected"
  | "queued_prompt"
  | "needs_input"
  | "running"
  | "open_tab";

export interface HotSessionTarget {
  clientSessionId: string;
  materializedSessionId: string | null;
  workspaceId: string;
  priority: number;
  reason: HotSessionReason;
  streamable: boolean;
}

export interface ResolveHotSessionTargetsInput {
  selectedWorkspaceId: string | null;
  activeSessionId: string | null;
  visibleChatSessionIds: readonly string[];
  workspaceSessionIds: readonly string[];
  directoryEntriesById: Record<string, SessionDirectoryEntry | undefined>;
  promptActivityBySessionId: Record<string, number | undefined>;
  maxHotSessionStreams?: number;
}

const PRIORITY_BY_REASON: Record<HotSessionReason, number> = {
  selected: 0,
  queued_prompt: 1,
  needs_input: 2,
  running: 3,
  open_tab: 4,
};

export function resolveHotSessionTargets(
  input: ResolveHotSessionTargetsInput,
): HotSessionTarget[] {
  if (!input.selectedWorkspaceId) {
    return [];
  }

  const candidates = new Map<string, HotSessionTarget>();
  const maxHotSessionStreams = input.maxHotSessionStreams ?? MAX_HOT_SESSION_STREAMS;

  const maybeAdd = (sessionId: string | null | undefined, reason: HotSessionReason) => {
    if (!sessionId) {
      return;
    }
    const entry = input.directoryEntriesById[sessionId];
    const workspaceId = entry?.workspaceId ?? null;
    if (!entry || !workspaceId || workspaceId !== input.selectedWorkspaceId) {
      return;
    }

    const priority = PRIORITY_BY_REASON[reason];
    const existing = candidates.get(sessionId);
    if (existing && existing.priority <= priority) {
      return;
    }

    candidates.set(sessionId, {
      clientSessionId: sessionId,
      materializedSessionId: entry.materializedSessionId,
      workspaceId,
      priority,
      reason,
      streamable: !!entry.materializedSessionId,
    });
  };

  maybeAdd(input.activeSessionId, "selected");

  const visibleSet = new Set(input.visibleChatSessionIds);
  for (const sessionId of input.visibleChatSessionIds) {
    maybeAdd(sessionId, "open_tab");
  }

  for (const sessionId of input.workspaceSessionIds) {
    const entry = input.directoryEntriesById[sessionId];
    if (!entry || entry.workspaceId !== input.selectedWorkspaceId) {
      continue;
    }

    if ((input.promptActivityBySessionId[sessionId] ?? 0) > 0) {
      maybeAdd(sessionId, "queued_prompt");
    }

    const viewState = resolveSessionViewState({
      status: entry.status,
      executionSummary: entry.executionSummary,
      streamConnectionState: entry.streamConnectionState,
      transcript: {
        isStreaming: entry.activity.isStreaming,
        pendingInteractions: entry.activity.pendingInteractions,
      },
    });
    if (viewState === "needs_input") {
      maybeAdd(sessionId, "needs_input");
    } else if (viewState === "working") {
      maybeAdd(sessionId, "running");
    } else if (visibleSet.has(sessionId)) {
      maybeAdd(sessionId, "open_tab");
    }
  }

  return Array.from(candidates.values())
    .sort((a, b) => a.priority - b.priority || a.clientSessionId.localeCompare(b.clientSessionId))
    .slice(0, maxHotSessionStreams);
}
