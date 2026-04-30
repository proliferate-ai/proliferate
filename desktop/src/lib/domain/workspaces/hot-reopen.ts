import type { TranscriptState } from "@anyharness/sdk";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import { logicalWorkspaceRelatedIds } from "@/lib/domain/workspaces/logical-workspaces";

export interface HotReopenSessionSlotSnapshot {
  sessionId: string;
  workspaceId: string | null;
  transcriptHydrated: boolean;
  events: readonly unknown[];
  transcript: Pick<TranscriptState, "turnOrder">;
  optimisticPrompt?: unknown | null;
}

export interface HotReopenCandidate {
  sessionId: string;
  workspaceId: string;
  source: "initial_active" | "last_viewed" | "cached_slot";
}

export function hotReopenWorkspaceLookupIds(
  resolvedWorkspaceId: string,
  logicalWorkspace: LogicalWorkspace | null,
): string[] {
  return uniqueStrings([
    resolvedWorkspaceId,
    logicalWorkspace?.id ?? null,
    ...(logicalWorkspace ? logicalWorkspaceRelatedIds(logicalWorkspace) : []),
  ]);
}

export function isHotReopenEligibleSessionSlot(
  slot: HotReopenSessionSlotSnapshot | null | undefined,
  resolvedWorkspaceId: string,
  isPendingSessionId: (sessionId: string) => boolean,
): slot is HotReopenSessionSlotSnapshot & { workspaceId: string } {
  if (!slot || slot.workspaceId !== resolvedWorkspaceId || isPendingSessionId(slot.sessionId)) {
    return false;
  }
  return slot.transcriptHydrated || isClearlyEmptyFreshSlot(slot);
}

export function resolveHotReopenCandidate(input: {
  resolvedWorkspaceId: string;
  logicalWorkspace: LogicalWorkspace | null;
  initialActiveSessionId?: string | null;
  lastViewedSessionByWorkspace: Record<string, string>;
  sessionSlots: Record<string, HotReopenSessionSlotSnapshot>;
  isPendingSessionId: (sessionId: string) => boolean;
}): HotReopenCandidate | null {
  const slotFor = (sessionId: string | null | undefined) =>
    sessionId ? input.sessionSlots[sessionId] ?? null : null;
  const toCandidate = (
    sessionId: string | null | undefined,
    source: HotReopenCandidate["source"],
  ): HotReopenCandidate | null => {
    const slot = slotFor(sessionId);
    return isHotReopenEligibleSessionSlot(
      slot,
      input.resolvedWorkspaceId,
      input.isPendingSessionId,
    )
      ? { sessionId: slot.sessionId, workspaceId: slot.workspaceId, source }
      : null;
  };

  const initialCandidate = toCandidate(input.initialActiveSessionId, "initial_active");
  if (initialCandidate) {
    return initialCandidate;
  }

  for (const workspaceId of hotReopenWorkspaceLookupIds(
    input.resolvedWorkspaceId,
    input.logicalWorkspace,
  )) {
    const candidate = toCandidate(
      input.lastViewedSessionByWorkspace[workspaceId],
      "last_viewed",
    );
    if (candidate) {
      return candidate;
    }
  }

  for (const slot of Object.values(input.sessionSlots)) {
    if (isHotReopenEligibleSessionSlot(
      slot,
      input.resolvedWorkspaceId,
      input.isPendingSessionId,
    )) {
      return {
        sessionId: slot.sessionId,
        workspaceId: slot.workspaceId,
        source: "cached_slot",
      };
    }
  }

  return null;
}

function isClearlyEmptyFreshSlot(slot: HotReopenSessionSlotSnapshot): boolean {
  return !slot.transcriptHydrated
    && slot.events.length === 0
    && slot.transcript.turnOrder.length === 0
    && !slot.optimisticPrompt;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (value && !result.includes(value)) {
      result.push(value);
    }
  }
  return result;
}
