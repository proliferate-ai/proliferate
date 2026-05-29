import type { Session } from "@anyharness/sdk";
import { getProviderDisplayName } from "@/lib/domain/agents/provider-display";
import {
  resolveSessionViewState,
  type SessionViewState,
} from "@proliferate/product-domain/sessions/activity";
import type { ChatVisibilityCandidate } from "@/lib/domain/workspaces/tabs/visibility";
import { activitySnapshotFromDirectoryEntry } from "@/lib/domain/sessions/directory/directory-activity";
import type { SessionDirectoryEntry } from "@/lib/domain/sessions/directory/directory-entry";

export type KnownHeaderSession =
  | { kind: "slot"; slot: SessionDirectoryEntry; session?: Session }
  | { kind: "session"; session: Session; clientSessionId?: string }
  | { kind: "placeholder"; sessionId: string };

export interface HeaderHierarchyChildRow {
  sessionLinkId: string;
  sessionId: string;
  parentSessionId: string;
  workspaceId?: string | null;
  title: string;
  agentKind: string;
  source: "subagent" | "review" | "cowork";
  reviewKind?: string | null;
  meta: string | null;
  statusLabel: string;
  wakeScheduled: boolean;
  isActive: boolean;
}

export function buildKnownHeaderSessions(args: {
  optimisticSessionIds?: readonly string[];
  sessions: readonly Session[] | null | undefined;
  selectedWorkspaceId: string | null;
  clientSessionIdByMaterializedSessionId: Readonly<Record<string, string | undefined>>;
  liveSlots: readonly SessionDirectoryEntry[];
}): Map<string, KnownHeaderSession> {
  const map = new Map<string, KnownHeaderSession>();
  for (const session of args.sessions ?? []) {
    if (session.dismissedAt) continue;
    if (!args.selectedWorkspaceId || session.workspaceId !== args.selectedWorkspaceId) continue;
    const clientSessionId =
      args.clientSessionIdByMaterializedSessionId[session.id] ?? session.id;
    map.set(clientSessionId, { kind: "session", session, clientSessionId });
  }
  for (const slot of args.liveSlots) {
    const existing = map.get(slot.sessionId);
    const existingSession = existing?.kind === "session"
      ? existing.session
      : existing?.kind === "slot"
        ? existing.session
        : undefined;
    map.set(slot.sessionId, {
      kind: "slot",
      slot,
      session: existingSession,
    });
  }
  for (const sessionId of args.optimisticSessionIds ?? []) {
    if (!map.has(sessionId)) {
      map.set(sessionId, { kind: "placeholder", sessionId });
    }
  }
  return map;
}

export function collectHierarchyChildren(
  childrenByParentSessionId: ReadonlyMap<string, readonly HeaderHierarchyChildRow[]>,
): {
  rowsBySessionId: Map<string, HeaderHierarchyChildRow>;
  childIdsByParentSessionId: Map<string, string[]>;
  visibilityCandidates: ChatVisibilityCandidate[];
} {
  const rowsBySessionId = new Map<string, HeaderHierarchyChildRow>();
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

export function buildHeaderLiveVisibilityCandidates(args: {
  knownSessionIds: readonly string[];
  childToParent: ReadonlyMap<string, string>;
  hierarchyVisibilityCandidates: readonly ChatVisibilityCandidate[];
}): ChatVisibilityCandidate[] {
  const candidatesBySessionId = new Map<string, ChatVisibilityCandidate>();
  for (const sessionId of args.knownSessionIds) {
    candidatesBySessionId.set(sessionId, {
      sessionId,
      parentSessionId: args.childToParent.get(sessionId) ?? null,
    });
  }
  for (const candidate of args.hierarchyVisibilityCandidates) {
    candidatesBySessionId.set(candidate.sessionId, candidate);
  }
  return Array.from(candidatesBySessionId.values());
}

export function resolveHierarchyMaterializedSessionId(input: {
  sessionId: string;
  materializedSessionId: string | null;
}): string | null {
  if (input.materializedSessionId) {
    return input.materializedSessionId;
  }
  return isTransientClientSessionId(input.sessionId) ? null : input.sessionId;
}

function isTransientClientSessionId(sessionId: string): boolean {
  return sessionId.startsWith("client-session:")
    || sessionId.startsWith("pending-session:");
}

export function getKnownSessionId(known: KnownHeaderSession): string {
  switch (known.kind) {
    case "slot":
      return known.slot.sessionId;
    case "session":
      return known.clientSessionId ?? known.session.id;
    case "placeholder":
      return known.sessionId;
  }
}

export function getKnownSessionAgentKind(known: KnownHeaderSession): string {
  switch (known.kind) {
    case "slot":
      return known.slot.agentKind;
    case "session":
      return known.session.agentKind;
    case "placeholder":
      return "";
  }
}

export function getKnownSessionTitle(known: KnownHeaderSession): string {
  if (known.kind === "placeholder") {
    return "Chat";
  }
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
  if (known.kind === "placeholder") {
    return "idle";
  }
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
  if (known.kind === "placeholder") {
    return false;
  }
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

export function getLinkedChildViewState(child: HeaderHierarchyChildRow): SessionViewState {
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
