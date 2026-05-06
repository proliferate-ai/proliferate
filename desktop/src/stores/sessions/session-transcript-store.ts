import { createTranscriptState, type TranscriptState } from "@anyharness/sdk";
import { create } from "zustand";
import type {
  SessionTranscriptEntry,
} from "@/stores/sessions/session-types";

type TranscriptEntryPatch = Partial<Omit<SessionTranscriptEntry, "sessionId">>;

interface SessionTranscriptState {
  entriesById: Record<string, SessionTranscriptEntry>;
  putEntry: (entry: SessionTranscriptEntry) => void;
  ensureEntry: (sessionId: string, transcript?: TranscriptState) => SessionTranscriptEntry;
  patchEntry: (sessionId: string, patch: TranscriptEntryPatch) => void;
  removeEntry: (sessionId: string) => void;
  removeEntries: (sessionIds: Iterable<string>) => void;
  clearEntries: () => void;
}

export const useSessionTranscriptStore = create<SessionTranscriptState>((set, get) => ({
  entriesById: {},

  putEntry: (entry) => set((state) => {
    const previous = state.entriesById[entry.sessionId];
    if (previous && transcriptEntryEqual(previous, entry)) {
      return state;
    }
    return {
      entriesById: {
        ...state.entriesById,
        [entry.sessionId]: entry,
      },
    };
  }),

  ensureEntry: (sessionId, transcript) => {
    const existing = get().entriesById[sessionId];
    if (existing) {
      return existing;
    }
    const entry: SessionTranscriptEntry = {
      sessionId,
      events: [],
      transcript: transcript ?? createTranscriptState(sessionId),
      optimisticPrompt: null,
    };
    get().putEntry(entry);
    return entry;
  },

  patchEntry: (sessionId, patch) => set((state) => {
    const existing = state.entriesById[sessionId];
    if (!existing) {
      return state;
    }
    const nextEntry = {
      ...existing,
      ...patch,
    };
    if (transcriptEntryEqual(existing, nextEntry)) {
      return state;
    }
    return {
      entriesById: {
        ...state.entriesById,
        [sessionId]: nextEntry,
      },
    };
  }),

  removeEntry: (sessionId) => set((state) => {
    if (!state.entriesById[sessionId]) {
      return state;
    }
    const { [sessionId]: _removed, ...entriesById } = state.entriesById;
    return { entriesById };
  }),

  removeEntries: (sessionIds) => set((state) => {
    const removed = new Set(sessionIds);
    if (removed.size === 0 || !Object.keys(state.entriesById).some((id) => removed.has(id))) {
      return state;
    }
    return {
      entriesById: Object.fromEntries(
        Object.entries(state.entriesById).filter(([sessionId]) => !removed.has(sessionId)),
      ),
    };
  }),

  clearEntries: () => set({ entriesById: {} }),
}));

export function createTranscriptEntry(
  sessionId: string,
  transcript?: TranscriptState,
): SessionTranscriptEntry {
  return {
    sessionId,
    events: [],
    transcript: transcript ?? createTranscriptState(sessionId),
    optimisticPrompt: null,
  };
}

function transcriptEntryEqual(
  a: SessionTranscriptEntry,
  b: SessionTranscriptEntry,
): boolean {
  return a.sessionId === b.sessionId
    && a.events === b.events
    && a.transcript === b.transcript
    && a.optimisticPrompt === b.optimisticPrompt;
}
