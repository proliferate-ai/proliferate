import type {
  PendingInteraction,
  SessionExecutionSummary,
  SessionStatus,
} from "@anyharness/sdk";
import { resolveSessionViewState } from "#product/domain/sessions/activity";

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

interface HotSessionDirectoryEntry {
  materializedSessionId: string | null;
  workspaceId: string | null;
  status: SessionStatus | null;
  executionSummary: SessionExecutionSummary | null;
  streamConnectionState: "disconnected" | "connecting" | "open" | "ended";
  activity: {
    isStreaming: boolean;
    pendingInteractions: PendingInteraction[];
  };
}

export interface ResolveHotSessionTargetsInput {
  selectedWorkspaceId: string | null;
  activeSessionId: string | null;
  visibleChatSessionIds: readonly string[];
  candidateSessionIds: readonly string[];
  directoryEntriesById: Record<string, HotSessionDirectoryEntry | undefined>;
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
  const candidates = new Map<string, HotSessionTarget>();
  const liveSessionIds = new Set<string>();
  const maxHotSessionStreams = input.maxHotSessionStreams ?? MAX_HOT_SESSION_STREAMS;

  const maybeAdd = (
    sessionId: string | null | undefined,
    reason: HotSessionReason,
    selectedWorkspaceOnly = false,
  ) => {
    if (!sessionId) {
      return;
    }
    const entry = input.directoryEntriesById[sessionId];
    const workspaceId = entry?.workspaceId ?? null;
    if (
      !entry
      || !workspaceId
      || (selectedWorkspaceOnly && workspaceId !== input.selectedWorkspaceId)
    ) {
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

  maybeAdd(input.activeSessionId, "selected", true);

  const visibleSet = new Set(input.visibleChatSessionIds);
  for (const sessionId of input.visibleChatSessionIds) {
    maybeAdd(sessionId, "open_tab", true);
  }

  // Live work remains hot across workspace and route navigation; otherwise
  // disconnecting its stream can make an idle summary mask active streaming.
  for (const sessionId of input.candidateSessionIds) {
    const entry = input.directoryEntriesById[sessionId];
    if (!entry) {
      continue;
    }

    if ((input.promptActivityBySessionId[sessionId] ?? 0) > 0) {
      liveSessionIds.add(sessionId);
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
      liveSessionIds.add(sessionId);
      maybeAdd(sessionId, "needs_input");
    } else if (viewState === "working") {
      liveSessionIds.add(sessionId);
      maybeAdd(sessionId, "running");
    } else if (visibleSet.has(sessionId)) {
      maybeAdd(sessionId, "open_tab", true);
    }
  }

  const orderedTargets = Array.from(candidates.values())
    .sort((a, b) => a.priority - b.priority || a.clientSessionId.localeCompare(b.clientSessionId));
  const mandatorySessionIds = new Set(liveSessionIds);
  if (input.activeSessionId && candidates.has(input.activeSessionId)) {
    mandatorySessionIds.add(input.activeSessionId);
  }
  const mandatoryTargetCount = orderedTargets.reduce(
    (count, target) => count + (mandatorySessionIds.has(target.clientSessionId) ? 1 : 0),
    0,
  );
  const passiveTargetBudget = Math.max(0, maxHotSessionStreams - mandatoryTargetCount);
  let retainedPassiveTargets = 0;

  // The cap limits passive open-tab retention. The selected session and live
  // work are correctness requirements: evicting a live target closes the only
  // stream that can deliver completion and leaves the sidebar with stale
  // activity.
  return orderedTargets.filter((target) => {
    if (mandatorySessionIds.has(target.clientSessionId)) {
      return true;
    }
    if (retainedPassiveTargets >= passiveTargetBudget) {
      return false;
    }
    retainedPassiveTargets += 1;
    return true;
  });
}
