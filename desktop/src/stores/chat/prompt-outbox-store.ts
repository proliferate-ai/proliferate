import { create } from "zustand";
import {
  bindOutboxSessionMaterialization,
  createPromptOutboxEntry,
  outboxEntriesForSession,
  patchPromptOutboxEntry,
  pruneEchoedOutboxTombstones,
  removePromptOutboxEntry,
  upsertPromptOutboxEntry,
  type PromptOutboxCreateInput,
  type PromptOutboxEntry,
  type PromptOutboxStateShape,
} from "@/lib/domain/chat/outbox/prompt-outbox";

interface PromptOutboxStoreState extends PromptOutboxStateShape {
  dispatchVersion: number;
  enqueue: (input: PromptOutboxCreateInput) => PromptOutboxEntry;
  patchEntry: (clientPromptId: string, patch: Partial<PromptOutboxEntry>) => void;
  removeEntry: (clientPromptId: string) => void;
  bindMaterializedSession: (clientSessionId: string, materializedSessionId: string) => void;
  pruneEchoedTombstones: () => void;
  clearSession: (clientSessionId: string) => void;
  clear: () => void;
}

const EMPTY_OUTBOX_STATE: PromptOutboxStateShape = {
  entriesByPromptId: {},
  promptIdsByClientSessionId: {},
};

export const usePromptOutboxStore = create<PromptOutboxStoreState>((set) => ({
  ...EMPTY_OUTBOX_STATE,
  dispatchVersion: 0,

  enqueue: (input) => {
    const entry = createPromptOutboxEntry(input);
    set((state) => {
      const next = upsertPromptOutboxEntry(state, entry);
      return {
        ...next,
        dispatchVersion: state.dispatchVersion + 1,
      };
    });
    return entry;
  },

  patchEntry: (clientPromptId, patch) => set((state) => {
    const next = patchPromptOutboxEntry(state, clientPromptId, patch);
    if (next === state) {
      return state;
    }
    return {
      ...next,
      dispatchVersion: state.dispatchVersion + 1,
    };
  }),

  removeEntry: (clientPromptId) => set((state) => {
    const next = removePromptOutboxEntry(state, clientPromptId);
    if (next === state) {
      return state;
    }
    return {
      ...next,
      dispatchVersion: state.dispatchVersion + 1,
    };
  }),

  bindMaterializedSession: (clientSessionId, materializedSessionId) => set((state) => {
    const next = bindOutboxSessionMaterialization(state, clientSessionId, materializedSessionId);
    if (next === state) {
      return state;
    }
    return {
      ...next,
      dispatchVersion: state.dispatchVersion + 1,
    };
  }),

  pruneEchoedTombstones: () => set((state) => {
    const next = pruneEchoedOutboxTombstones(state);
    if (next === state) {
      return state;
    }
    return {
      ...next,
      dispatchVersion: state.dispatchVersion + 1,
    };
  }),

  clearSession: (clientSessionId) => set((state) => {
    const entries = outboxEntriesForSession(state, clientSessionId);
    if (entries.length === 0) {
      return state;
    }
    let next: PromptOutboxStateShape = state;
    for (const entry of entries) {
      next = removePromptOutboxEntry(next, entry.clientPromptId);
    }
    return {
      ...next,
      dispatchVersion: state.dispatchVersion + 1,
    };
  }),

  clear: () => set((state) => ({
    ...EMPTY_OUTBOX_STATE,
    dispatchVersion: state.dispatchVersion + 1,
  })),
}));

export function getPromptOutboxEntriesForSession(clientSessionId: string | null | undefined): PromptOutboxEntry[] {
  return outboxEntriesForSession(usePromptOutboxStore.getState(), clientSessionId);
}

export function getPromptOutboxEntry(clientPromptId: string | null | undefined): PromptOutboxEntry | null {
  if (!clientPromptId) {
    return null;
  }
  return usePromptOutboxStore.getState().entriesByPromptId[clientPromptId] ?? null;
}
