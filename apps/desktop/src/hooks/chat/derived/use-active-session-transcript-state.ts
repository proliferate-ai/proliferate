import type { PendingPromptEntry, TranscriptState } from "@anyharness/sdk";
import { hasVisibleTranscriptContent } from "@proliferate/product-domain/chats/pending-prompts/pending-prompts";
import { isSessionSlotBusy, resolveSessionViewState, type SessionViewState } from "@proliferate/product-domain/sessions/activity";
import { outboxEntriesForSession } from "@proliferate/product-domain/sessions/intents/session-intent-state";
import { renderableOutboxEntriesForTranscript } from "@proliferate/product-domain/sessions/intents/session-intent-selectors";
import type { PromptOutboxEntry } from "@proliferate/product-domain/sessions/intents/session-intent-model";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { activitySnapshotFromDirectoryEntry } from "@/lib/domain/sessions/directory/directory-activity";
import type { SessionStreamConnectionState } from "@/lib/domain/sessions/directory/directory-entry";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { useActiveSessionId } from "./use-active-session-identity";

const EMPTY_OUTBOX_ENTRIES: readonly PromptOutboxEntry[] = [];

export function useActiveSessionTranscript(): TranscriptState | null {
  const activeSessionId = useActiveSessionId();
  return useSessionTranscriptStore((state) =>
    activeSessionId ? state.entriesById[activeSessionId]?.transcript ?? null : null
  );
}

export function useActiveTranscriptPaneState(): {
  activeSessionId: string | null;
  transcript: TranscriptState | null;
  optimisticPrompt: PendingPromptEntry | null;
  outboxEntries: readonly PromptOutboxEntry[];
  sessionViewState: SessionViewState;
  oldestLoadedEventSeq: number | null;
} {
  const activeSessionId = useActiveSessionId();
  const sessionViewState = useSessionDirectoryStore((state) =>
    activeSessionId
      ? resolveSessionViewState(
          activitySnapshotFromDirectoryEntry(state.entriesById[activeSessionId]),
        )
      : "idle"
  );
  const transcriptState = useSessionTranscriptStore(useShallow((state) => {
    const transcriptEntry = activeSessionId ? state.entriesById[activeSessionId] ?? null : null;
    return {
      activeSessionId,
      transcript: transcriptEntry?.transcript ?? null,
      optimisticPrompt: transcriptEntry?.optimisticPrompt ?? null,
      oldestLoadedEventSeq: transcriptEntry?.events?.[0]?.seq ?? null,
    };
  }));
  const outboxEntries = useSessionIntentStore(useShallow((state) =>
    activeSessionId ? outboxEntriesForSession(state, activeSessionId) : EMPTY_OUTBOX_ENTRIES
  ));
  return useMemo(() => ({
    ...transcriptState,
    outboxEntries,
    sessionViewState,
  }), [outboxEntries, sessionViewState, transcriptState]);
}

export function useActiveSessionSurfaceSnapshot(): {
  activeSessionId: string | null;
  hasContent: boolean;
  hasTranscriptEntry: boolean;
  hasSlot: boolean;
  transcriptHydrated: boolean;
  isEmpty: boolean;
  isRunning: boolean;
  sessionViewState: SessionViewState;
  streamConnectionState: SessionStreamConnectionState | null;
} {
  const activeSessionId = useActiveSessionId();
  const directoryState = useSessionDirectoryStore(useShallow((state) => {
    const directory = activeSessionId ? state.entriesById[activeSessionId] ?? null : null;
    return {
      hasSlot: directory !== null,
      transcriptHydrated: directory?.transcriptHydrated ?? false,
      isRunning: isSessionSlotBusy(activitySnapshotFromDirectoryEntry(directory)),
      sessionViewState: resolveSessionViewState(activitySnapshotFromDirectoryEntry(directory)),
      streamConnectionState: directory?.streamConnectionState ?? null,
    };
  }));
  const transcriptState = useSessionTranscriptStore(useShallow((state) => {
    const transcriptEntry = activeSessionId ? state.entriesById[activeSessionId] ?? null : null;
    const transcript = transcriptEntry?.transcript ?? null;
    const optimisticPrompt = transcriptEntry?.optimisticPrompt ?? null;
    const hasContent = transcript
      ? hasVisibleTranscriptContent({ transcript, optimisticPrompt })
      : optimisticPrompt !== null;
    return {
      activeSessionId,
      hasContent,
      hasTranscriptEntry: transcriptEntry !== null,
      transcript,
    };
  }));
  const hasRenderableOutbox = useSessionIntentStore((state) => {
    const entries = outboxEntriesForSession(state, activeSessionId);
    if (entries.length === 0) {
      return false;
    }
    return transcriptState.transcript
      ? renderableOutboxEntriesForTranscript(entries, transcriptState.transcript).length > 0
      : true;
  });
  const hasContent = transcriptState.hasContent || hasRenderableOutbox;
  return {
    activeSessionId: transcriptState.activeSessionId,
    hasContent,
    hasTranscriptEntry: transcriptState.hasTranscriptEntry,
    ...directoryState,
    isEmpty: transcriptState.activeSessionId !== null
      && directoryState.hasSlot
      && !hasContent,
  };
}
