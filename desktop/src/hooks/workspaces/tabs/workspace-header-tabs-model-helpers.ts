import type { Session } from "@anyharness/sdk";
import { getProviderDisplayName } from "@/config/providers";
import type { HeaderSubagentChildRow } from "@/hooks/workspaces/tabs/use-workspace-header-subagent-hierarchy";
import {
  resolveSessionViewState,
  type SessionViewState,
} from "@/lib/domain/sessions/activity";
import type { ChatVisibilityCandidate } from "@/lib/domain/workspaces/tabs/visibility";
import {
  activitySnapshotFromDirectoryEntry,
} from "@/stores/sessions/session-directory-store";
import type { SessionDirectoryEntry } from "@/stores/sessions/session-types";

export type KnownHeaderSession =
  | { kind: "slot"; slot: SessionDirectoryEntry; session?: Session }
  | { kind: "session"; session: Session; clientSessionId?: string };

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
  return known.kind === "slot"
    ? known.slot.sessionId
    : known.clientSessionId ?? known.session.id;
}

export function getKnownSessionAgentKind(known: KnownHeaderSession): string {
  return known.kind === "slot" ? known.slot.agentKind : known.session.agentKind;
}

export function getKnownSessionTitle(known: KnownHeaderSession): string {
  if (known.kind === "slot") {
    return (
      known.slot.title?.trim()
      || known.slot.activity.transcriptTitle?.trim()
      || getProviderDisplayName(known.slot.agentKind)
    );
  }
  return known.session.title?.trim()
    || getProviderDisplayName(known.session.agentKind);
}

export function getKnownSessionViewState(known: KnownHeaderSession): SessionViewState {
  if (known.kind === "slot") {
    const viewState = resolveSessionViewState(activitySnapshotFromDirectoryEntry(known.slot));
    return shouldSuppressMaterializationActivity(known.slot, viewState) ? "idle" : viewState;
  }
  return resolveSessionViewState({
    status: known.session.status,
    executionSummary: known.session.executionSummary ?? null,
    streamConnectionState: "disconnected",
    transcript: { isStreaming: false, pendingInteractions: [] },
  });
}

function shouldSuppressMaterializationActivity(
  slot: SessionDirectoryEntry,
  viewState: SessionViewState,
): boolean {
  if (viewState !== "working") {
    return false;
  }
  const hasTranscriptActivity = slot.activity.isStreaming
    || slot.activity.pendingInteractions.length > 0
    || (slot.executionSummary?.pendingInteractions?.length ?? 0) > 0;
  if (hasTranscriptActivity) {
    return false;
  }

  return !slot.materializedSessionId
    || slot.status === "starting"
    || slot.executionSummary?.phase === "starting"
    || slot.streamConnectionState === "connecting";
}

export function getKnownSessionCanFork(known: KnownHeaderSession): boolean {
  if (getKnownSessionViewState(known) !== "idle") {
    return false;
  }
  if (known.kind === "slot") {
    return Boolean(
      known.slot.actionCapabilities.fork
        || known.session?.actionCapabilities.fork,
    );
  }
  if (known.session.status === "closed" || known.session.dismissedAt) {
    return false;
  }
  return Boolean(known.session.actionCapabilities.fork);
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
