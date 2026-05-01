import type { Session } from "@anyharness/sdk";
import { getProviderDisplayName } from "@/config/providers";
import type { HeaderSubagentChildRow } from "@/hooks/workspaces/tabs/use-workspace-header-subagent-hierarchy";
import {
  resolveSessionViewState,
  type SessionViewState,
} from "@/lib/domain/sessions/activity";
import { getEffectiveSessionTitle } from "@/lib/domain/sessions/title";
import type { ChatVisibilityCandidate } from "@/lib/domain/workspaces/tabs/visibility";
import type { SessionSlot } from "@/stores/sessions/harness-store";

export type KnownHeaderSession =
  | { kind: "slot"; slot: SessionSlot }
  | { kind: "session"; session: Session };

export function collectHierarchyChildren(
  childrenByParentSessionId: ReadonlyMap<string, readonly HeaderSubagentChildRow[]>,
): {
  rowsBySessionId: Map<string, HeaderSubagentChildRow>;
  childIdsByParentSessionId: Map<string, string[]>;
  visibilityCandidates: ChatVisibilityCandidate[];
} {
  const rowsBySessionId = new Map<string, HeaderSubagentChildRow>();
  const childIdsByParentSessionId = new Map<string, string[]>();
  const visibilityCandidates: ChatVisibilityCandidate[] = [];
  for (const [parentSessionId, children] of childrenByParentSessionId) {
    for (const child of children) {
      rowsBySessionId.set(child.sessionId, child);
      const childIds = childIdsByParentSessionId.get(parentSessionId) ?? [];
      childIds.push(child.sessionId);
      childIdsByParentSessionId.set(parentSessionId, childIds);
      visibilityCandidates.push({
        sessionId: child.sessionId,
        parentSessionId,
      });
    }
  }
  return { rowsBySessionId, childIdsByParentSessionId, visibilityCandidates };
}

export function getKnownSessionId(known: KnownHeaderSession): string {
  return known.kind === "slot" ? known.slot.sessionId : known.session.id;
}

export function getKnownSessionAgentKind(known: KnownHeaderSession): string {
  return known.kind === "slot" ? known.slot.agentKind : known.session.agentKind;
}

export function getKnownSessionTitle(known: KnownHeaderSession): string {
  if (known.kind === "slot") {
    return getEffectiveSessionTitle(known.slot)
      ?? getProviderDisplayName(known.slot.agentKind);
  }
  return known.session.title?.trim()
    || getProviderDisplayName(known.session.agentKind);
}

export function getKnownSessionViewState(known: KnownHeaderSession): SessionViewState {
  if (known.kind === "slot") {
    return resolveSessionViewState(known.slot);
  }
  return resolveSessionViewState({
    status: known.session.status,
    executionSummary: known.session.executionSummary ?? null,
    streamConnectionState: "disconnected",
    transcript: { isStreaming: false, pendingInteractions: [] },
  });
}

export function getLinkedChildViewState(child: HeaderSubagentChildRow): SessionViewState {
  switch (child.statusLabel) {
    case "Starting":
    case "Working":
      return "working";
    case "Failed":
    case "Timed out":
      return "errored";
    case "Closed":
      return "closed";
    case "Cancelled":
    case "Done":
    case "Idle":
    default:
      return "idle";
  }
}
