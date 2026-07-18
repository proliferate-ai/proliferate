import type { AssistantMessageRevealState } from "#product/components/workspace/chat/transcript/AssistantMessage";

const MAX_CACHED_ASSISTANT_REVEALS = 500;

const revealProgressByItemId = new Map<string, AssistantMessageRevealState>();

export function getAssistantRevealProgress(
  itemId: string | null,
): AssistantMessageRevealState | null {
  return itemId ? revealProgressByItemId.get(itemId) ?? null : null;
}

export function recordAssistantRevealProgress(
  itemId: string,
  state: AssistantMessageRevealState,
): void {
  // Refresh insertion order so the bounded map behaves as a tiny LRU. This
  // state exists only to bridge React row remounts; the transcript remains the
  // source of truth for content.
  revealProgressByItemId.delete(itemId);
  revealProgressByItemId.set(itemId, state);
  while (revealProgressByItemId.size > MAX_CACHED_ASSISTANT_REVEALS) {
    const oldestItemId = revealProgressByItemId.keys().next().value;
    if (typeof oldestItemId !== "string") {
      break;
    }
    revealProgressByItemId.delete(oldestItemId);
  }
}

export function clearAssistantRevealProgressForTests(): void {
  revealProgressByItemId.clear();
}
