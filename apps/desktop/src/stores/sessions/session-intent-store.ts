import { create } from "zustand";
import type {
  SessionEventEnvelope,
  TranscriptState,
} from "@anyharness/sdk";
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
} from "@proliferate/product-domain/sessions/intents/session-intent-model";
import {
  pruneEchoedOutboxTombstones,
  pruneEchoedOutboxTombstonesForTranscript,
  reconcileOutboxFromEnvelopes,
} from "@proliferate/product-domain/sessions/intents/session-intent-reconciliation";
import {
  bindSessionIntentMaterialization,
  getPromptEntryByPromptId,
  patchSessionIntent,
  removeSessionIntent,
  sessionIntentsForSession,
  upsertSessionIntent,
  type SessionIntentStateShape,
} from "@proliferate/product-domain/sessions/intents/session-intent-state";
import { recordStoreActionDebugActivity } from "@/lib/infra/measurement/debug-jank-activity";
import { isDebugMeasurementEnabled } from "@/lib/infra/measurement/debug-measurement-env";
import { now as measurementNow } from "@/lib/infra/measurement/debug-measurement-utils";

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
  reconcileFromEnvelopes: (
    clientSessionId: string,
    envelopes: readonly SessionEventEnvelope[],
    transcript?: TranscriptState | null,
  ) => void;
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
    const debugStartedAtMs = startSessionIntentStoreActionTrace();
    const entry = createPromptOutboxEntry(input);
    set((state) => {
      const next = withDispatchVersion(state, upsertSessionIntent(state, entry));
      recordSessionIntentStoreAction("enqueuePrompt", state, next, {
        clientSessionId: entry.clientSessionId,
        intentKind: entry.kind,
        placement: entry.placement,
        workspaceId: entry.workspaceId,
      }, debugStartedAtMs);
      return next;
    });
    return entry;
  },

  enqueueConfig: (input) => {
    const debugStartedAtMs = startSessionIntentStoreActionTrace();
    const intent = createUpdateConfigIntent({
      ...input,
      intentId: input.intentId ?? createSessionIntentId("config"),
    });
    set((state) => {
      const next = withDispatchVersion(state, upsertSessionIntent(state, intent));
      recordSessionIntentStoreAction("enqueueConfig", state, next, {
        clientSessionId: intent.clientSessionId,
        configId: intent.configId,
        intentKind: intent.kind,
        workspaceId: intent.workspaceId,
      }, debugStartedAtMs);
      return next;
    });
    return intent;
  },

  enqueueInteraction: (input) => {
    const debugStartedAtMs = startSessionIntentStoreActionTrace();
    const intent = createResolveInteractionIntent({
      ...input,
      intentId: input.intentId ?? createSessionIntentId("interaction"),
    });
    set((state) => {
      const next = withDispatchVersion(state, upsertSessionIntent(state, intent));
      recordSessionIntentStoreAction("enqueueInteraction", state, next, {
        action: intent.action,
        clientSessionId: intent.clientSessionId,
        intentKind: intent.kind,
        workspaceId: intent.workspaceId,
      }, debugStartedAtMs);
      return next;
    });
    return intent;
  },

  enqueueEditPendingPrompt: (input) => {
    const debugStartedAtMs = startSessionIntentStoreActionTrace();
    const intent = createEditPendingPromptIntent({
      ...input,
      intentId: input.intentId ?? createSessionIntentId("edit-prompt"),
    });
    set((state) => {
      const next = withDispatchVersion(state, upsertSessionIntent(state, intent));
      recordSessionIntentStoreAction("enqueueEditPendingPrompt", state, next, {
        clientSessionId: intent.clientSessionId,
        intentKind: intent.kind,
        seq: intent.seq,
        workspaceId: intent.workspaceId,
      }, debugStartedAtMs);
      return next;
    });
    return intent;
  },

  enqueueDeletePendingPrompt: (input) => {
    const debugStartedAtMs = startSessionIntentStoreActionTrace();
    const intent = createDeletePendingPromptIntent({
      ...input,
      intentId: input.intentId ?? createSessionIntentId("delete-prompt"),
    });
    set((state) => {
      const next = withDispatchVersion(state, upsertSessionIntent(state, intent));
      recordSessionIntentStoreAction("enqueueDeletePendingPrompt", state, next, {
        clientSessionId: intent.clientSessionId,
        intentKind: intent.kind,
        seq: intent.seq,
        workspaceId: intent.workspaceId,
      }, debugStartedAtMs);
      return next;
    });
    return intent;
  },

  patchIntent: (intentId, patch) => {
    const debugStartedAtMs = startSessionIntentStoreActionTrace();
    set((state) => {
      const existing = state.entriesById[intentId];
      const next = withDispatchVersion(state, patchSessionIntent(state, intentId, patch));
      recordSessionIntentStoreAction("patchIntent", state, next, {
        clientSessionId: existing?.clientSessionId ?? null,
        intentKind: existing?.kind ?? null,
        status: "status" in patch ? patch.status ?? null : null,
        workspaceId: existing?.workspaceId ?? null,
      }, debugStartedAtMs);
      return next;
    });
  },

  removeIntent: (intentId) => {
    const debugStartedAtMs = startSessionIntentStoreActionTrace();
    set((state) => {
      const existing = state.entriesById[intentId];
      const next = withDispatchVersion(state, removeSessionIntent(state, intentId));
      recordSessionIntentStoreAction("removeIntent", state, next, {
        clientSessionId: existing?.clientSessionId ?? null,
        intentKind: existing?.kind ?? null,
        workspaceId: existing?.workspaceId ?? null,
      }, debugStartedAtMs);
      return next;
    });
  },

  bindMaterializedSession: (clientSessionId, materializedSessionId) => {
    const debugStartedAtMs = startSessionIntentStoreActionTrace();
    set((state) => {
      const next = withDispatchVersion(
        state,
        bindSessionIntentMaterialization(state, clientSessionId, materializedSessionId),
      );
      recordSessionIntentStoreAction("bindMaterializedSession", state, next, {
        clientSessionId,
        materializedSessionId,
      }, debugStartedAtMs);
      return next;
    });
  },

  reconcileFromEnvelopes: (clientSessionId, envelopes, transcript) => {
    if (envelopes.length === 0) {
      return;
    }
    const debugStartedAtMs = startSessionIntentStoreActionTrace();
    set((state) => {
      const reconciled = reconcileOutboxFromEnvelopes(state, clientSessionId, envelopes);
      const pruned = transcript
        ? pruneEchoedOutboxTombstonesForTranscript(reconciled, transcript)
        : reconciled;
      const next = withDispatchVersion(state, pruned);
      recordSessionIntentStoreAction("reconcileFromEnvelopes", state, next, {
        clientSessionId,
        envelopeCount: envelopes.length,
      }, debugStartedAtMs);
      return next;
    });
  },

  pruneEchoedTombstones: () => {
    const debugStartedAtMs = startSessionIntentStoreActionTrace();
    set((state) => {
      const next = withDispatchVersion(state, pruneEchoedOutboxTombstones(state));
      recordSessionIntentStoreAction("pruneEchoedTombstones", state, next, {}, debugStartedAtMs);
      return next;
    });
  },

  clearSession: (clientSessionId) => {
    const debugStartedAtMs = startSessionIntentStoreActionTrace();
    set((state) => {
      const entries = sessionIntentsForSession(state, clientSessionId);
      if (entries.length === 0) {
        return state;
      }
      let next: SessionIntentStateShape = state;
      for (const entry of entries) {
        next = removeSessionIntent(next, entry.intentId);
      }
      const versionedNext = withDispatchVersion(state, next);
      recordSessionIntentStoreAction("clearSession", state, versionedNext, {
        clientSessionId,
      }, debugStartedAtMs);
      return versionedNext;
    });
  },

  clear: () => {
    const debugStartedAtMs = startSessionIntentStoreActionTrace();
    set((state) => {
      const next = {
        ...EMPTY_SESSION_INTENT_STATE,
        dispatchVersion: state.dispatchVersion + 1,
      };
      recordSessionIntentStoreAction("clear", state, next, {}, debugStartedAtMs);
      return next;
    });
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

function startSessionIntentStoreActionTrace(): number | null {
  return isDebugMeasurementEnabled() ? measurementNow() : null;
}

function recordSessionIntentStoreAction(
  action: string,
  before: SessionIntentStateShape,
  after: SessionIntentStateShape,
  metadata: Record<string, unknown>,
  startedAtMs: number | null,
): void {
  if (startedAtMs === null) {
    return;
  }
  const clientSessionId = typeof metadata.clientSessionId === "string"
    ? metadata.clientSessionId
    : null;
  recordStoreActionDebugActivity({
    label: `session-intent-store.${action}`,
    startedAtMs,
    metadata: {
      ...metadata,
      afterCount: countSessionIntents(after, clientSessionId),
      beforeCount: countSessionIntents(before, clientSessionId),
      totalAfterCount: Object.keys(after.entriesById).length,
      totalBeforeCount: Object.keys(before.entriesById).length,
    },
  });
}

function countSessionIntents(
  state: SessionIntentStateShape,
  clientSessionId: string | null,
): number | null {
  if (!clientSessionId) {
    return null;
  }
  return state.intentIdsByClientSessionId[clientSessionId]?.length ?? 0;
}
