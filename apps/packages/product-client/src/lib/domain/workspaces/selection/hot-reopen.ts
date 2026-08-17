import type { TranscriptState } from "@anyharness/sdk";
import type { LogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-model";
import { logicalWorkspaceRelatedIds } from "#product/lib/domain/workspaces/cloud/logical-workspace-lookup";

export interface HotReopenSessionSlotSnapshot {
  sessionId: string;
  materializedSessionId?: string | null;
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
  return [...new Set([
    resolvedWorkspaceId,
    logicalWorkspace?.id,
    ...(logicalWorkspace ? logicalWorkspaceRelatedIds(logicalWorkspace) : []),
  ].filter(Boolean))] as string[];
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
  hiddenSessionIds?: ReadonlySet<string>;
}): HotReopenCandidate | null {
  const hiddenSessionIds = input.hiddenSessionIds;
  // Last-viewed bookkeeping stores materialized session ids (client ids are
  // transient and never persisted), but a session created in this app run
  // keeps its slot keyed by the client session id. Resolve through the slot's
  // materialized id so a remembered id still finds its slot; otherwise the
  // last-viewed candidate silently loses to an arbitrary cached slot.
  const slotFor = (sessionId: string | null | undefined) => {
    if (!sessionId) {
      return null;
    }
    return input.sessionSlots[sessionId]
      ?? Object.values(input.sessionSlots).find(
        (slot) => slot.materializedSessionId === sessionId,
      )
      ?? null;
  };
  const toCandidate = (
    sessionId: string | null | undefined,
    source: HotReopenCandidate["source"],
  ): HotReopenCandidate | null => {
    const slot = slotFor(sessionId);
    // Implicit sources must not resurrect a session whose tab the user closed:
    // a hidden session gets no tab, so activating it strands the shell on the
    // chat-shell surface with the composer armed at an invisible session. The
    // hidden set holds slot keys while a remembered id may be the materialized
    // alias, so check every id the session is known by.
    if (
      source !== "initial_active"
      && slot
      && hiddenSessionIds
      && (
        hiddenSessionIds.has(slot.sessionId)
        || (slot.materializedSessionId && hiddenSessionIds.has(slot.materializedSessionId))
      )
    ) {
      return null;
    }
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
    const candidate = toCandidate(slot.sessionId, "cached_slot");
    if (candidate) {
      return candidate;
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
