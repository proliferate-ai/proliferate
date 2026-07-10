import type { SessionExecutionPhase, SessionExecutionSummary, SessionStatus, WorkspaceExecutionSummary } from "@anyharness/sdk";

import type {
  ErrorAttentionTranscriptItem,
  PendingInteractionLike,
  SessionActivitySnapshot,
  SessionErrorAttentionSnapshot,
  SessionViewState,
  SidebarSessionActivityState,
} from "./activity-types";

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
    if (reconciledStatus === "starting") {
      return "starting";
    }
    return !hasActionablePending && isSessionSettlingAfterFinalProse(input)
      ? "idle"
      : "running";
  }

  return reconciledStatus ?? null;
}

/**
 * The settling window: the live transcript's latest turn already ends in
 * completed assistant prose, but executionSummary.phase still says "running"
 * because turn_ended / backend persistence lags the final tokens by seconds.
 * Presenting "iterating" here reads as a dead stall under a finished answer —
 * the same evidence shouldAllowTurnTrailingStatus uses to suppress the
 * trailing "Thinking…" indicator says the session should present as idle.
 *
 * Guards keep phase authoritative everywhere else: the transcript evidence
 * only counts when the session's stream is open (a live stream delivers the
 * next item or turn_ended, so a genuinely-continuing agent flips us back),
 * and never while actionable interactions are pending. Tool calls, thoughts,
 * and streaming prose all leave a non-final tail, so genuinely running states
 * are unaffected.
 */
export function isSessionSettlingAfterFinalProse(
  slot: Pick<
    SessionActivitySnapshot,
    "executionSummary" | "streamConnectionState" | "transcript"
  > | null | undefined,
): boolean {
  if (!slot || slot.transcript.endsInFinalAssistantProse !== true) {
    return false;
  }
  if (slot.streamConnectionState !== "open") {
    return false;
  }
  return !hasActionablePendingInteractions(slot);
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
    if (
      slot.executionSummary.phase === "starting"
      && slot.hasPromptActivity === false
      && !isSessionEffectivelyStreaming(slot)
    ) {
      return "idle";
    }
    if (
      slot.executionSummary.phase === "running"
      && isSessionSettlingAfterFinalProse(slot)
    ) {
      return "idle";
    }
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
    return slot.hasPromptActivity === false && !isSessionEffectivelyStreaming(slot)
      ? "idle"
      : "starting";
  }
  if (slot.status === "running" || isSessionEffectivelyStreaming(slot)) {
    return isSessionSettlingAfterFinalProse(slot) ? "idle" : "running";
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

export function hasActionablePendingInteractions(
  slot: Pick<SessionActivitySnapshot, "executionSummary" | "transcript">,
): boolean {
  return pendingInteractionsForActivity(slot).some((interaction) =>
    !isPlanOwnedPendingInteraction(interaction)
  );
}

export function pendingInteractionsForActivity(
  slot: Pick<SessionActivitySnapshot, "executionSummary" | "transcript">,
): PendingInteractionLike[] {
  const summaryPending = slot.executionSummary?.pendingInteractions;
  return summaryPending && summaryPending.length > 0
    ? summaryPending
    : slot.transcript.pendingInteractions;
}

export function isPlanOwnedPendingInteraction(interaction: PendingInteractionLike): boolean {
  return Boolean(interaction.linkedPlanId || interaction.source?.linkedPlanId);
}
