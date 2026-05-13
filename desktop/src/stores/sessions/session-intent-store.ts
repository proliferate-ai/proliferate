import { create } from "zustand";
import {
  createDeletePendingPromptIntent,
  createEditPendingPromptIntent,
  createPromptOutboxEntry,
  createResolveInteractionIntent,
  createUpdateConfigIntent,
  type PromptOutboxCreateInput,
  type PromptOutboxEntry,
  type SessionDeletePendingPromptIntent,
  type SessionEditPendingPromptIntent,
  type SessionIntent,
  type SessionResolveInteractionIntent,
  type SessionUpdateConfigIntent,
} from "@/lib/domain/sessions/intents/session-intent-model";
import { pruneEchoedOutboxTombstones } from "@/lib/domain/sessions/intents/session-intent-reconciliation";
import {
  bindSessionIntentMaterialization,
  getPromptEntryByPromptId,
  patchSessionIntent,
  removeSessionIntent,
  sessionIntentsForSession,
  upsertSessionIntent,
  type SessionIntentStateShape,
} from "@/lib/domain/sessions/intents/session-intent-state";

interface SessionIntentStoreState extends SessionIntentStateShape {
  dispatchVersion: number;
  enqueuePrompt: (input: PromptOutboxCreateInput) => PromptOutboxEntry;
  enqueueConfig: (input: Omit<Parameters<typeof createUpdateConfigIntent>[0], "intentId"> & {
    intentId?: string;
  }) => SessionUpdateConfigIntent;
  enqueueInteraction: (input: Omit<Parameters<typeof createResolveInteractionIntent>[0], "intentId"> & {
    intentId?: string;
  }) => SessionResolveInteractionIntent;
  enqueueEditPendingPrompt: (input: Omit<Parameters<typeof createEditPendingPromptIntent>[0], "intentId"> & {
    intentId?: string;
  }) => SessionEditPendingPromptIntent;
  enqueueDeletePendingPrompt: (input: Omit<Parameters<typeof createDeletePendingPromptIntent>[0], "intentId"> & {
    intentId?: string;
  }) => SessionDeletePendingPromptIntent;
  patchIntent: (intentId: string, patch: Partial<SessionIntent>) => void;
  removeIntent: (intentId: string) => void;
  bindMaterializedSession: (clientSessionId: string, materializedSessionId: string) => void;
  pruneEchoedTombstones: () => void;
  clearSession: (clientSessionId: string) => void;
  clear: () => void;
}

const EMPTY_SESSION_INTENT_STATE: SessionIntentStateShape = {
  entriesById: {},
  intentIdsByClientSessionId: {},
};

let nextSessionIntentId = 0;

export const useSessionIntentStore = create<SessionIntentStoreState>((set) => ({
  ...EMPTY_SESSION_INTENT_STATE,
  dispatchVersion: 0,

  enqueuePrompt: (input) => {
    const entry = createPromptOutboxEntry(input);
    set((state) => withDispatchVersion(state, upsertSessionIntent(state, entry)));
    return entry;
  },

  enqueueConfig: (input) => {
    const intent = createUpdateConfigIntent({
      ...input,
      intentId: input.intentId ?? createSessionIntentId("config"),
    });
    set((state) => withDispatchVersion(state, upsertSessionIntent(state, intent)));
    return intent;
  },

  enqueueInteraction: (input) => {
    const intent = createResolveInteractionIntent({
      ...input,
      intentId: input.intentId ?? createSessionIntentId("interaction"),
    });
    set((state) => withDispatchVersion(state, upsertSessionIntent(state, intent)));
    return intent;
  },

  enqueueEditPendingPrompt: (input) => {
    const intent = createEditPendingPromptIntent({
      ...input,
      intentId: input.intentId ?? createSessionIntentId("edit-prompt"),
    });
    set((state) => withDispatchVersion(state, upsertSessionIntent(state, intent)));
    return intent;
  },

  enqueueDeletePendingPrompt: (input) => {
    const intent = createDeletePendingPromptIntent({
      ...input,
      intentId: input.intentId ?? createSessionIntentId("delete-prompt"),
    });
    set((state) => withDispatchVersion(state, upsertSessionIntent(state, intent)));
    return intent;
  },

  patchIntent: (intentId, patch) => {
    set((state) => withDispatchVersion(state, patchSessionIntent(state, intentId, patch)));
  },

  removeIntent: (intentId) => {
    set((state) => withDispatchVersion(state, removeSessionIntent(state, intentId)));
  },

  bindMaterializedSession: (clientSessionId, materializedSessionId) => {
    set((state) => withDispatchVersion(
      state,
      bindSessionIntentMaterialization(state, clientSessionId, materializedSessionId),
    ));
  },

  pruneEchoedTombstones: () => {
    set((state) => withDispatchVersion(state, pruneEchoedOutboxTombstones(state)));
  },

  clearSession: (clientSessionId) => set((state) => {
    const entries = sessionIntentsForSession(state, clientSessionId);
    if (entries.length === 0) {
      return state;
    }
    let next: SessionIntentStateShape = state;
    for (const entry of entries) {
      next = removeSessionIntent(next, entry.intentId);
    }
    return withDispatchVersion(state, next);
  }),

  clear: () => {
    set((state) => ({
      ...EMPTY_SESSION_INTENT_STATE,
      dispatchVersion: state.dispatchVersion + 1,
    }));
  },
}));

export function getSessionIntentsForSession(clientSessionId: string | null | undefined): SessionIntent[] {
  return sessionIntentsForSession(useSessionIntentStore.getState(), clientSessionId);
}

export function getPromptOutboxEntriesForSession(clientSessionId: string | null | undefined): PromptOutboxEntry[] {
  return getSessionIntentsForSession(clientSessionId)
    .filter((intent): intent is PromptOutboxEntry => intent.kind === "send_prompt");
}

export function getPromptOutboxEntry(clientPromptId: string | null | undefined): PromptOutboxEntry | null {
  return getPromptEntryByPromptId(useSessionIntentStore.getState(), clientPromptId);
}

function withDispatchVersion<T extends SessionIntentStoreState>(
  current: T,
  next: SessionIntentStateShape,
): T | (SessionIntentStateShape & { dispatchVersion: number }) {
  if (next === current) {
    return current;
  }
  return {
    ...next,
    dispatchVersion: current.dispatchVersion + 1,
  };
}

function createSessionIntentId(prefix: string): string {
  nextSessionIntentId += 1;
  return `session-intent:${prefix}:${Date.now()}:${nextSessionIntentId}`;
}
