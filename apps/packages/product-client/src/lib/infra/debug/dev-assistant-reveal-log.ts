import type { AssistantMessageRevealState } from "#product/components/workspace/chat/transcript/AssistantMessage";

export interface DevAssistantRevealRecord extends AssistantMessageRevealState {
  turnId: string;
  itemId: string;
  recordedAt: string;
  visibleDelta: number | null;
  targetDelta: number | null;
  elapsedMs: number | null;
}

export function logDevAssistantRevealState({
  turnId,
  itemId,
  state,
}: {
  turnId: string;
  itemId: string;
  state: AssistantMessageRevealState;
}): void {
  if (!import.meta.env.DEV || !isDevAssistantRevealLoggingEnabled()) {
    return;
  }

  const debugGlobal = globalThis as typeof globalThis & {
    __PROLIFERATE_ASSISTANT_REVEALS__?: DevAssistantRevealRecord[];
    __PROLIFERATE_ASSISTANT_REVEAL_LAST__?: Record<string, DevAssistantRevealRecord>;
    __PROLIFERATE_ASSISTANT_REVEAL_CONSOLE__?: boolean;
  };
  const existing = debugGlobal.__PROLIFERATE_ASSISTANT_REVEALS__ ?? [];
  const lastByItemId = debugGlobal.__PROLIFERATE_ASSISTANT_REVEAL_LAST__ ?? {};
  const previous = lastByItemId[itemId] ?? null;
  const recordedAt = new Date().toISOString();
  const record: DevAssistantRevealRecord = {
    ...state,
    turnId,
    itemId,
    recordedAt,
    visibleDelta: previous ? state.visibleLength - previous.visibleLength : null,
    targetDelta: previous ? state.targetLength - previous.targetLength : null,
    elapsedMs: previous
      ? Date.parse(recordedAt) - Date.parse(previous.recordedAt)
      : null,
  };

  existing.push(record);
  if (existing.length > 1_000) {
    existing.splice(0, 500);
  }
  lastByItemId[itemId] = record;
  debugGlobal.__PROLIFERATE_ASSISTANT_REVEALS__ = existing;
  debugGlobal.__PROLIFERATE_ASSISTANT_REVEAL_LAST__ = lastByItemId;
  if (debugGlobal.__PROLIFERATE_ASSISTANT_REVEAL_CONSOLE__ === true) {
    console.debug("[assistant-reveal]", record);
  }
}

let devAssistantRevealQueryEnabled: boolean | null = null;

function isDevAssistantRevealLoggingEnabled(): boolean {
  const debugGlobal = globalThis as typeof globalThis & {
    __PROLIFERATE_ASSISTANT_PERFORMANCE_ENABLED__?: boolean;
  };
  if (debugGlobal.__PROLIFERATE_ASSISTANT_PERFORMANCE_ENABLED__ === true) {
    return true;
  }
  if (typeof window === "undefined") {
    return false;
  }
  if (devAssistantRevealQueryEnabled === null) {
    devAssistantRevealQueryEnabled =
      new URLSearchParams(window.location.search).get("debugAssistantPerformance") === "1";
  }
  return devAssistantRevealQueryEnabled;
}
