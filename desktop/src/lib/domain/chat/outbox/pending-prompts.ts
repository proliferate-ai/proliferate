import type {
  ContentPart,
  PendingPromptEntry,
  PromptSessionStatus,
  SessionEventEnvelope,
  SessionStatus,
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
  contentParts: ContentPart[] = text ? [{ type: "text", text }] : [],
): PendingPromptEntry {
  return {
    seq: -Date.now(),
    promptId,
    text,
    contentParts,
    queuedAt,
    promptProvenance: null,
  };
}

export function hasVisibleTranscriptContent(args: {
  transcript: TranscriptState;
  optimisticPrompt: PendingPromptEntry | null;
}): boolean {
  return args.transcript.turnOrder.some((turnId) =>
    turnHasRenderableTranscriptContent(args.transcript.turnsById[turnId], args.transcript)
  )
    || args.optimisticPrompt !== null;
}

export function resolveVisibleOptimisticPrompt(args: {
  optimisticPrompt: PendingPromptEntry | null;
  latestTurnStartedAt: string | null;
  latestTurnHasAssistantRenderableContent: boolean;
}): PendingPromptEntry | null {
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

export function shouldClearOptimisticPromptAfterPromptResponse(
  status: PromptSessionStatus,
): boolean {
  return status === "queued";
}

export function shouldClearOptimisticPromptAfterSessionSummary(
  status: SessionStatus | null | undefined,
): boolean {
  return status === "idle"
    || status === "completed"
    || status === "errored"
    || status === "closed";
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

export function shouldClearOptimisticPendingPromptForEnvelope(
  envelope: SessionEventEnvelope,
  optimisticPrompt: PendingPromptEntry | null,
): boolean {
  if (!optimisticPrompt) {
    return false;
  }

  const event = envelope.event;
  if (shouldClearOptimisticPendingPrompt(event.type)) {
    return true;
  }

  if (
    (event.type === "item_started" || event.type === "item_completed")
    && event.item.kind === "user_message"
  ) {
    return true;
  }

  return false;
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
