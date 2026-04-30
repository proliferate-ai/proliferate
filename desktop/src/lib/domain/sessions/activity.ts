import type {
  SessionExecutionPhase,
  SessionExecutionSummary,
  SessionStatus,
  WorkspaceExecutionSummary,
} from "@anyharness/sdk";

type StreamConnectionState = "disconnected" | "connecting" | "open" | "ended";

export type SessionViewState =
  | "working"
  | "needs_input"
  | "idle"
  | "errored"
  | "closed";

export type SidebarSessionActivityState =
  | "iterating"
  | "waiting_input"
  | "waiting_plan"
  | "error"
  | "closed"
  | "idle";

interface SessionActivitySnapshot {
  status: SessionStatus | null;
  executionSummary?: SessionExecutionSummary | null;
  streamConnectionState?: StreamConnectionState;
  transcript: {
    isStreaming: boolean;
    pendingInteractions: PendingInteractionLike[];
  };
}

interface PendingInteractionLike {
  requestId?: string;
  linkedPlanId?: string | null;
  source?: {
    linkedPlanId?: string | null;
  } | null;
}

interface SessionErrorAttentionSnapshot {
  sessionId: string;
  status: SessionStatus | null;
  executionSummary?: SessionExecutionSummary | null;
  transcript: {
    itemsById: Record<string, ErrorAttentionTranscriptItem>;
  };
}

interface ErrorAttentionTranscriptItem {
  kind: string;
  itemId: string;
  startedSeq: number;
}

export function resolveStatusFromExecutionSummary(
  executionSummary: SessionExecutionSummary | null | undefined,
  fallbackStatus: SessionStatus | null | undefined,
): SessionStatus | null {
  switch (executionSummary?.phase) {
    case "starting":
      return "starting";
    case "running":
    case "awaiting_interaction":
      return "running";
    case "idle":
      return "idle";
    case "errored":
      return "errored";
    case "closed":
      return "closed";
    default:
      return fallbackStatus ?? null;
  }
}

export function resolveSessionStatus(
  status: SessionStatus | null | undefined,
  input: Pick<
    SessionActivitySnapshot,
    "executionSummary" | "streamConnectionState" | "transcript"
  >,
): SessionStatus | null {
  if (status === "completed") {
    return status;
  }

  const reconciledStatus = resolveStatusFromExecutionSummary(input.executionSummary, status);
  if (reconciledStatus === "closed" || reconciledStatus === "errored") {
    return reconciledStatus;
  }
  const hasActionablePending = hasActionablePendingInteractions(input);
  const effectivelyStreaming = isSessionEffectivelyStreaming({
    status: reconciledStatus ?? null,
    executionSummary: input.executionSummary,
    streamConnectionState: input.streamConnectionState,
    transcript: input.transcript,
  });

  if (
    input.executionSummary?.phase === "awaiting_interaction"
    && !hasActionablePending
    && !effectivelyStreaming
  ) {
    return "idle";
  }

  if (
    reconciledStatus === "starting"
    || reconciledStatus === "running"
    || effectivelyStreaming
    || hasActionablePending
  ) {
    return reconciledStatus === "starting" ? "starting" : "running";
  }

  return reconciledStatus ?? null;
}

export function isSessionEffectivelyStreaming(
  slot: SessionActivitySnapshot,
): boolean {
  if (!slot.transcript.isStreaming) {
    return false;
  }
  if (
    slot.status === "idle"
    && (slot.streamConnectionState === "ended"
      || slot.streamConnectionState === "disconnected")
  ) {
    return false;
  }
  return true;
}

interface WorkspaceSessionActivitySnapshot extends SessionActivitySnapshot {
  workspaceId: string | null;
}

interface WorkspaceSessionSidebarAttentionSnapshot
  extends WorkspaceSessionActivitySnapshot {
  sessionId: string;
  errorAttentionKey: string | null;
}

export function resolveSessionExecutionPhase(
  slot: SessionActivitySnapshot | null | undefined,
): SessionExecutionPhase | null {
  if (!slot) {
    return null;
  }

  if (
    slot.executionSummary?.phase === "awaiting_interaction"
    && !hasActionablePendingInteractions(slot)
  ) {
    return isSessionEffectivelyStreaming(slot) ? "running" : "idle";
  }

  if (slot.executionSummary?.phase) {
    return slot.executionSummary.phase;
  }

  if (slot.status === "closed") {
    return "closed";
  }
  if (slot.status === "errored") {
    return "errored";
  }
  if (hasActionablePendingInteractions(slot)) {
    return "awaiting_interaction";
  }
  if (slot.status === "starting") {
    return "starting";
  }
  if (slot.status === "running" || isSessionEffectivelyStreaming(slot)) {
    return "running";
  }
  return "idle";
}

export function resolveSessionViewState(
  slot: SessionActivitySnapshot | null | undefined,
): SessionViewState {
  if (!slot) {
    return "idle";
  }

  switch (resolveSessionExecutionPhase(slot)) {
    case "starting":
    case "running":
      return "working";
    case "awaiting_interaction":
      return "needs_input";
    case "errored":
      return "errored";
    case "closed":
      return "closed";
    case "idle":
    default:
      return "idle";
  }
}

export function resolveSessionSidebarActivityState(
  slot: SessionActivitySnapshot | null | undefined,
): SidebarSessionActivityState {
  if (!slot) {
    return "idle";
  }

  const pendingInteractions = pendingInteractionsForActivity(slot);
  const hasPendingInput = pendingInteractions.some((interaction) =>
    !isPlanOwnedPendingInteraction(interaction)
  );
  const hasPendingPlan = pendingInteractions.some(isPlanOwnedPendingInteraction);

  if (slot.executionSummary?.phase === "errored" || slot.status === "errored") {
    return "error";
  }
  if (hasPendingInput) {
    return "waiting_input";
  }
  if (hasPendingPlan) {
    return "waiting_plan";
  }

  switch (resolveSessionExecutionPhase(slot)) {
    case "starting":
    case "running":
      return "iterating";
    case "awaiting_interaction":
      return "waiting_input";
    case "errored":
      return "error";
    case "closed":
      return "closed";
    case "idle":
    default:
      return "idle";
  }
}

export function resolveSessionErrorAttentionKey(
  slot: SessionErrorAttentionSnapshot | null | undefined,
): string | null {
  if (!slot) {
    return null;
  }

  const hasCurrentError =
    slot.executionSummary?.phase === "errored" || slot.status === "errored";
  if (!hasCurrentError) {
    return null;
  }

  let latestErrorItem: ErrorAttentionTranscriptItem | null = null;
  for (const item of Object.values(slot.transcript.itemsById)) {
    if (item.kind !== "error") {
      continue;
    }
    if (
      !latestErrorItem
      || item.startedSeq > latestErrorItem.startedSeq
      || (item.startedSeq === latestErrorItem.startedSeq
        && item.itemId > latestErrorItem.itemId)
    ) {
      latestErrorItem = item;
    }
  }

  if (latestErrorItem) {
    return `error-item:${latestErrorItem.itemId}`;
  }

  if (slot.executionSummary?.phase === "errored") {
    return `summary-terminal:${slot.sessionId}`;
  }

  return null;
}

export function shouldSkipColdIdleSessionStream(
  slot: SessionActivitySnapshot | null | undefined,
  allowColdIdleNoStream?: boolean,
): boolean {
  if (!allowColdIdleNoStream || !slot) {
    return false;
  }

  return resolveSessionViewState(slot) === "idle"
    && slot.executionSummary?.hasLiveHandle !== true;
}

export function resolveWorkspaceExecutionViewState(
  summary: WorkspaceExecutionSummary | null | undefined,
): SessionViewState {
  switch (summary?.phase) {
    case "awaiting_interaction":
      return "needs_input";
    case "running":
      return "working";
    case "errored":
      return "errored";
    case "idle":
    default:
      return "idle";
  }
}

export function resolveWorkspaceExecutionSidebarActivityState(
  summary: WorkspaceExecutionSummary | null | undefined,
): SidebarSessionActivityState {
  switch (summary?.phase) {
    case "awaiting_interaction":
      return "waiting_input";
    case "running":
      return "iterating";
    case "errored":
      return "error";
    case "idle":
    default:
      return "idle";
  }
}

export function isSessionSlotBusy(
  slot: SessionActivitySnapshot | null | undefined,
): boolean {
  const viewState = resolveSessionViewState(slot);
  return viewState === "working" || viewState === "needs_input";
}

function hasActionablePendingInteractions(
  slot: Pick<SessionActivitySnapshot, "executionSummary" | "transcript">,
): boolean {
  return pendingInteractionsForActivity(slot).some((interaction) =>
    !isPlanOwnedPendingInteraction(interaction)
  );
}

function pendingInteractionsForActivity(
  slot: Pick<SessionActivitySnapshot, "executionSummary" | "transcript">,
): PendingInteractionLike[] {
  const summaryPending = slot.executionSummary?.pendingInteractions;
  return summaryPending && summaryPending.length > 0
    ? summaryPending
    : slot.transcript.pendingInteractions;
}

function isPlanOwnedPendingInteraction(interaction: PendingInteractionLike): boolean {
  return Boolean(interaction.linkedPlanId || interaction.source?.linkedPlanId);
}

export function sessionSlotBelongsToWorkspace(
  slot: { workspaceId: string | null } | null | undefined,
  workspaceId: string | null | undefined,
): boolean {
  return !!slot && !!workspaceId && slot.workspaceId === workspaceId;
}

export function closeSessionSlotHandles(
  slots: Record<string, { sseHandle: { close(): void } | null }>,
): void {
  for (const slot of Object.values(slots)) {
    slot.sseHandle?.close();
  }
}

export function collectWorkspaceSessionViewStates(
  sessionSlots: Record<string, WorkspaceSessionActivitySnapshot>,
): Record<string, SessionViewState> {
  const states: Record<string, SessionViewState> = {};

  for (const slot of Object.values(sessionSlots)) {
    if (!slot.workspaceId) {
      continue;
    }

    const nextState = resolveSessionViewState(slot);
    const currentState = states[slot.workspaceId];
    if (!currentState || sessionViewStatePriority(nextState) > sessionViewStatePriority(currentState)) {
      states[slot.workspaceId] = nextState;
    }
  }

  return states;
}

export function collectWorkspaceSidebarActivityStates(
  sessionSlots: Record<string, WorkspaceSessionActivitySnapshot>,
): Record<string, SidebarSessionActivityState> {
  const states: Record<string, SidebarSessionActivityState> = {};

  for (const slot of Object.values(sessionSlots)) {
    if (!slot.workspaceId) {
      continue;
    }

    const nextState = resolveSessionSidebarActivityState(slot);
    const currentState = states[slot.workspaceId];
    if (
      !currentState
      || sidebarSessionActivityPriority(nextState) > sidebarSessionActivityPriority(currentState)
    ) {
      states[slot.workspaceId] = nextState;
    }
  }

  return states;
}

export function collectWorkspaceSidebarActivityStatesWithErrorAttention(
  sessionSlots: Record<string, WorkspaceSessionSidebarAttentionSnapshot>,
  lastViewedSessionErrorAtBySession: Record<string, string>,
): Record<string, SidebarSessionActivityState> {
  const states: Record<string, SidebarSessionActivityState> = {};

  for (const slot of Object.values(sessionSlots)) {
    if (!slot.workspaceId) {
      continue;
    }

    const nextState = resolveSessionSidebarActivityState(slot);
    const attentionState =
      nextState === "error"
        && slot.errorAttentionKey !== null
        && lastViewedSessionErrorAtBySession[slot.sessionId] === slot.errorAttentionKey
        ? "idle"
        : nextState;
    const currentState = states[slot.workspaceId];
    if (
      !currentState
      || sidebarSessionActivityPriority(attentionState) > sidebarSessionActivityPriority(currentState)
    ) {
      states[slot.workspaceId] = attentionState;
    }
  }

  return states;
}

function sessionViewStatePriority(state: SessionViewState): number {
  switch (state) {
    case "needs_input":
      return 4;
    case "working":
      return 3;
    case "errored":
      return 2;
    case "closed":
      return 1;
    case "idle":
    default:
      return 0;
  }
}

function sidebarSessionActivityPriority(state: SidebarSessionActivityState): number {
  switch (state) {
    case "error":
      return 5;
    case "waiting_input":
      return 4;
    case "waiting_plan":
      return 3;
    case "iterating":
      return 2;
    case "closed":
      return 1;
    case "idle":
    default:
      return 0;
  }
}
