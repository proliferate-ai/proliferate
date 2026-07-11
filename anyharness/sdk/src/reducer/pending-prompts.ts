import type {
  ContentPart,
  PendingPromptAddedEvent,
  PendingPromptRemovedEvent,
  PendingPromptsReorderedEvent,
  PendingPromptUpdatedEvent,
} from "../types/events.js";
import type { PendingPromptEntry } from "../types/reducer.js";

type PendingPromptEvent =
  | PendingPromptAddedEvent
  | PendingPromptUpdatedEvent
  | PendingPromptRemovedEvent
  | PendingPromptsReorderedEvent;

type NormalizeContentParts = (parts: ContentPart[]) => ContentPart[];

export function reducePendingPrompts(
  entries: PendingPromptEntry[],
  event: PendingPromptEvent,
  normalizeContentParts: NormalizeContentParts,
): PendingPromptEntry[] {
  switch (event.type) {
    case "pending_prompt_added":
      return upsertPendingPrompt(entries, {
        seq: event.seq,
        promptId: event.promptId ?? null,
        text: event.text,
        contentParts: normalizeContentParts(event.contentParts ?? []),
        queuedAt: event.queuedAt,
        promptProvenance: event.promptProvenance ?? null,
      });

    case "pending_prompt_updated":
      return entries.map((entry) =>
        pendingPromptMatches(entry, event.seq)
          ? {
            ...entry,
            seq: event.seq,
            promptId: event.promptId ?? entry.promptId,
            text: event.text,
            contentParts: normalizeContentParts(event.contentParts ?? []),
            promptProvenance: event.promptProvenance ?? entry.promptProvenance,
          }
          : entry,
      );

    case "pending_prompt_removed":
      return entries.filter((entry) => !pendingPromptMatches(entry, event.seq));

    case "pending_prompts_reordered":
      return (event.pendingPrompts ?? []).map((summary) => ({
        seq: summary.seq,
        promptId: summary.promptId ?? null,
        text: summary.text,
        contentParts: normalizeContentParts(summary.contentParts ?? []),
        queuedAt: summary.queuedAt,
        promptProvenance: summary.promptProvenance ?? null,
      }));
  }
}

function pendingPromptMatches(entry: PendingPromptEntry, seq: number): boolean {
  return entry.seq === seq;
}

function upsertPendingPrompt(
  entries: PendingPromptEntry[],
  nextEntry: PendingPromptEntry,
): PendingPromptEntry[] {
  const index = entries.findIndex((entry) => pendingPromptMatches(entry, nextEntry.seq));
  if (index === -1) {
    return [...entries, nextEntry];
  }
  return entries.map((entry, entryIndex) =>
    entryIndex === index
      ? {
        ...entry,
        ...nextEntry,
        promptId: nextEntry.promptId ?? entry.promptId,
      }
      : entry
  );
}
