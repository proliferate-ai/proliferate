import type {
  PendingPromptEntry,
  SessionEvent,
  TranscriptItem,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";
import type { SessionViewState } from "@/lib/domain/sessions/activity";

export function createOptimisticPendingPrompt(
  text: string,
  promptId: string | null = null,
  queuedAt = new Date().toISOString(),
): PendingPromptEntry {
  return {
    seq: -Date.now(),
    promptId,
    text,
    queuedAt,
  };
}

export function hasVisibleTranscriptContent(args: {
  transcript: TranscriptState;
  pendingPrompts: readonly PendingPromptEntry[];
  optimisticPrompt: PendingPromptEntry | null;
}): boolean {
  return args.transcript.turnOrder.some((turnId) =>
    turnHasRenderableTranscriptContent(args.transcript.turnsById[turnId], args.transcript)
  )
    || args.pendingPrompts.length > 0
    || args.optimisticPrompt !== null;
}

export function resolveVisibleTranscriptPendingPrompt(args: {
  pendingPrompts: readonly PendingPromptEntry[];
  optimisticPrompt: PendingPromptEntry | null;
  latestTurnStartedAt: string | null;
  latestTurnHasAssistantRenderableContent: boolean;
}): PendingPromptEntry | null {
  const latestPendingPrompt = args.pendingPrompts[args.pendingPrompts.length - 1] ?? null;
  if (
    latestPendingPrompt
    && !isPromptSupersededByTurn(
      latestPendingPrompt,
      args.latestTurnStartedAt,
      args.latestTurnHasAssistantRenderableContent,
    )
  ) {
    return latestPendingPrompt;
  }

  if (
    args.optimisticPrompt
    && !isPromptSupersededByTurn(
      args.optimisticPrompt,
      args.latestTurnStartedAt,
      args.latestTurnHasAssistantRenderableContent,
    )
  ) {
    return args.optimisticPrompt;
  }

  return null;
}

export function shouldShowPendingPromptActivity(args: {
  optimisticPrompt: PendingPromptEntry | null;
  sessionViewState: SessionViewState;
}): boolean {
  return args.optimisticPrompt !== null
    || args.sessionViewState === "working"
    || args.sessionViewState === "needs_input";
}

export function shouldClearOptimisticPendingPrompt(
  eventType: SessionEvent["type"],
): boolean {
  switch (eventType) {
    case "turn_ended":
    case "error":
    case "session_ended":
      return true;
    default:
      return false;
  }
}

export function turnHasRenderableTranscriptContent(
  turn: TurnRecord | null | undefined,
  transcript: TranscriptState,
): boolean {
  if (!turn) {
    return false;
  }

  return turn.itemOrder.some((itemId) => isTranscriptItemRenderable(transcript.itemsById[itemId]));
}

export function turnHasAssistantRenderableTranscriptContent(
  turn: TurnRecord | null | undefined,
  transcript: TranscriptState,
): boolean {
  if (!turn) {
    return false;
  }

  return turn.itemOrder.some((itemId) =>
    isAssistantTranscriptItemRenderable(transcript.itemsById[itemId])
  );
}

function isPromptSupersededByTurn(
  prompt: PendingPromptEntry,
  latestTurnStartedAt: string | null,
  latestTurnHasAssistantRenderableContent: boolean,
): boolean {
  if (!latestTurnStartedAt) {
    return false;
  }

  return new Date(latestTurnStartedAt).getTime() >= new Date(prompt.queuedAt).getTime()
    && latestTurnHasAssistantRenderableContent;
}

function isTranscriptItemRenderable(item: TranscriptItem | undefined): boolean {
  if (!item) {
    return false;
  }

  switch (item.kind) {
    case "assistant_prose":
      return !!item.text;
    case "plan":
      return false;
    default:
      return true;
  }
}

function isAssistantTranscriptItemRenderable(item: TranscriptItem | undefined): boolean {
  if (!item || item.kind === "user_message") {
    return false;
  }

  return isTranscriptItemRenderable(item);
}
