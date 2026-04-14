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

interface SessionActivitySnapshot {
  status: SessionStatus | null;
  executionSummary?: SessionExecutionSummary | null;
  streamConnectionState?: StreamConnectionState;
  transcript: {
    isStreaming: boolean;
    pendingInteractions: unknown[];
  };
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

  if (
    reconciledStatus === "starting"
    || reconciledStatus === "running"
    || isSessionEffectivelyStreaming({
      status: reconciledStatus ?? null,
      executionSummary: input.executionSummary,
      streamConnectionState: input.streamConnectionState,
      transcript: input.transcript,
    })
    || input.transcript.pendingInteractions.length > 0
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

export function resolveSessionExecutionPhase(
  slot: SessionActivitySnapshot | null | undefined,
): SessionExecutionPhase | null {
  if (!slot) {
    return null;
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
  if (slot.transcript.pendingInteractions.length > 0) {
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

export function isSessionSlotBusy(
  slot: SessionActivitySnapshot | null | undefined,
): boolean {
  const viewState = resolveSessionViewState(slot);
  return viewState === "working" || viewState === "needs_input";
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
