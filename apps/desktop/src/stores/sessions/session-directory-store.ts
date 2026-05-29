import { create } from "zustand";
import type { TranscriptState } from "@anyharness/sdk";
import { activityFromTranscript } from "@/lib/domain/sessions/directory/directory-activity";
import {
  activitySummaryEqual,
  directoryEntryEqual,
  normalizeDirectoryEntryInput,
  normalizePatchedDirectoryEntry,
  type DirectoryEntryInput,
  type DirectoryEntryPatch,
  type SessionDirectoryEntry,
} from "@/lib/domain/sessions/directory/directory-entry";
import {
  applyPendingRelationshipHint,
  putDirectoryEntry,
  recordDirectoryRelationshipHint,
  removeDirectoryEntry,
  removeWorkspaceDirectoryEntries,
  setDirectoryEntryRelationship,
} from "@/lib/domain/sessions/directory/directory-reducer";
import type {
  SessionChildRelationship,
  SessionRelationship,
} from "@/lib/domain/sessions/directory/relationship";

interface SessionDirectoryState {
  entriesById: Record<string, SessionDirectoryEntry>;
  clientSessionIdByMaterializedSessionId: Record<string, string>;
  sessionIdsByWorkspaceId: Record<string, readonly string[]>;
  relationshipHintsBySessionId: Record<string, SessionChildRelationship>;
  putEntry: (entry: SessionDirectoryEntry) => void;
  upsertEntry: (input: DirectoryEntryInput) => void;
  patchEntry: (sessionId: string, patch: DirectoryEntryPatch) => void;
  patchActivityFromTranscript: (sessionId: string, transcript: TranscriptState) => void;
  removeEntry: (sessionId: string) => void;
  removeWorkspaceEntries: (workspaceId: string) => string[];
  clearEntries: () => void;
  recordRelationshipHint: (sessionId: string, relationship: SessionChildRelationship) => void;
  setSessionRelationship: (sessionId: string, relationship: SessionRelationship) => void;
}

export const useSessionDirectoryStore = create<SessionDirectoryState>((set) => ({
  entriesById: {},
  clientSessionIdByMaterializedSessionId: {},
  sessionIdsByWorkspaceId: {},
  relationshipHintsBySessionId: {},

  putEntry: (entry) => set((state) => {
    const hint = state.relationshipHintsBySessionId[entry.sessionId];
    const nextEntry = applyPendingRelationshipHint(entry, hint);
    return putDirectoryEntry(state, nextEntry);
  }),

  upsertEntry: (input) => set((state) => {
    const existing = state.entriesById[input.sessionId];
    const hint = state.relationshipHintsBySessionId[input.sessionId];
    const entry = normalizeDirectoryEntryInput(input, existing, hint);
    return putDirectoryEntry(state, entry);
  }),

  patchEntry: (sessionId, patch) => set((state) => {
    const entry = state.entriesById[sessionId];
    if (!entry) {
      return state;
    }
    const nextEntry = normalizePatchedDirectoryEntry(entry, patch);
    if (directoryEntryEqual(entry, nextEntry)) {
      return state;
    }
    return putDirectoryEntry(state, nextEntry);
  }),

  patchActivityFromTranscript: (sessionId, transcript) => set((state) => {
    const entry = state.entriesById[sessionId];
    if (!entry) {
      return state;
    }
    const activity = activityFromTranscript(transcript, {
      status: entry.status,
      executionSummary: entry.executionSummary,
    });
    if (activitySummaryEqual(entry.activity, activity)) {
      return state;
    }
    return putDirectoryEntry(state, {
      ...entry,
      modeId: transcript.currentModeId ?? entry.modeId,
      title: entry.title ?? transcript.sessionMeta.title ?? null,
      activity,
    });
  }),

  removeEntry: (sessionId) => set((state) => removeDirectoryEntry(state, sessionId)),

  removeWorkspaceEntries: (workspaceId) => {
    let removedSessionIds: string[] = [];
    set((state) => {
      const result = removeWorkspaceDirectoryEntries(state, workspaceId);
      removedSessionIds = result.removedSessionIds;
      return result.state;
    });
    return removedSessionIds;
  },

  clearEntries: () => set({
    entriesById: {},
    clientSessionIdByMaterializedSessionId: {},
    sessionIdsByWorkspaceId: {},
    relationshipHintsBySessionId: {},
  }),

  recordRelationshipHint: (sessionId, relationship) => set((state) =>
    recordDirectoryRelationshipHint(state, sessionId, relationship)
  ),

  setSessionRelationship: (sessionId, relationship) => set((state) =>
    setDirectoryEntryRelationship(state, sessionId, relationship)
  ),
}));
