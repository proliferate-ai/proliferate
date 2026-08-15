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
} from "#product/domain/sessions/intents/session-intent-model";
import {
  applyAdoptedSessionConfigIntentResolutionPlan,
  applyConfigIntentSettlementPlan,
  type AdoptedSessionConfigIntentResolutionPlan,
  type ConfigIntentSettlementPlan,
} from "#product/lib/domain/sessions/creation/config-intent-settlement";
import {
  pruneEchoedOutboxTombstones,
  pruneEchoedOutboxTombstonesForTranscript,
  reconcileOutboxFromEnvelopes,
} from "#product/domain/sessions/intents/session-intent-reconciliation";
import {
  bindSessionIntentMaterialization,
  findSupersedableTailConfigIntent,
  getPromptEntryByPromptId,
  patchSessionIntent,
  removeSessionIntent,
  sessionIntentsForSession,
  upsertSessionIntent,
  type SessionIntentStateShape,
} from "#product/domain/sessions/intents/session-intent-state";
import { recordStoreActionDebugActivity } from "#product/lib/infra/measurement/measurement-port";
import { isDebugMeasurementEnabled } from "#product/lib/infra/measurement/measurement-port";
import { now as measurementNow } from "#product/lib/infra/measurement/measurement-port";

interface SessionIntentStoreState extends SessionIntentStateShape {
  dispatchVersion: number;
  enqueuePrompt: (input: PromptOutboxCreateInput) => PromptOutboxEntry;
  enqueueConfig: (input: SessionConfigIntentEnqueueInput) => SessionUpdateConfigIntent;
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
  applyConfigIntentSettlement: (plan: ConfigIntentSettlementPlan) => void;
  applyAdoptedSessionConfigIntentResolution: (
    plan: AdoptedSessionConfigIntentResolutionPlan,
  ) => void;
  reassignClientSession: (clientSessionId: string, nextClientSessionId: string) => void;
  reconcileFromEnvelopes: (
    clientSessionId: string,
    envelopes: readonly SessionEventEnvelope[],
    transcript?: TranscriptState | null,
  ) => void;
  pruneEchoedTombstones: () => void;
  clearSession: (clientSessionId: string) => void;
  clear: () => void;
}

type SessionConfigIntentEnqueueInput = Omit<
  Parameters<typeof createUpdateConfigIntent>[0],
  "intentId" | "controlKey" | "rawConfigId"
> & {
  intentId?: string;
} & (
  | { configId: string; controlKey?: string }
  | { configId: null; controlKey: string }
);

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
    const controlKey = input.controlKey ?? input.configId;
    if (!controlKey) {
      throw new Error("A semantic control key is required for a launch-only config intent");
    }
    // Same intent id and queue position: the burst reads as one selection
    // whose value kept changing, and ordering against any later intents is
    // untouched. Skipped when the caller pins an explicit intentId.
    const supersedable = input.intentId
      ? null
      : findSupersedableTailConfigIntent(
        useSessionIntentStore.getState(),
        input.clientSessionId,
        controlKey,
      );
    const intent: SessionUpdateConfigIntent = supersedable
      ? {
        ...supersedable,
        rawConfigId: input.configId,
        value: input.value,
        materializedSessionId: input.materializedSessionId ?? supersedable.materializedSessionId,
        workspaceId: input.workspaceId ?? supersedable.workspaceId,
        persistDefaultPreference: input.persistDefaultPreference ?? supersedable.persistDefaultPreference,
        updatedAt: new Date().toISOString(),
      }
      : createUpdateConfigIntent({
        clientSessionId: input.clientSessionId,
        materializedSessionId: input.materializedSessionId,
        workspaceId: input.workspaceId,
        controlKey,
        rawConfigId: input.configId,
        value: input.value,
        persistDefaultPreference: input.persistDefaultPreference,
        now: input.now,
        intentId: input.intentId ?? createSessionIntentId("config"),
      });
    set((state) => {
      const next = withDispatchVersion(state, upsertSessionIntent(state, intent));
      recordSessionIntentStoreAction("enqueueConfig", state, next, {
        clientSessionId: intent.clientSessionId,
        controlKey: intent.controlKey,
        rawConfigId: intent.rawConfigId,
        intentKind: intent.kind,
        superseded: Boolean(supersedable),
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

  applyConfigIntentSettlement: (plan) => {
    if (plan.patches.length === 0) {
      return;
    }
    const debugStartedAtMs = startSessionIntentStoreActionTrace();
    set((state) => {
      const next = withDispatchVersion(
        state,
        applyConfigIntentSettlementPlan(state, plan),
      );
      recordSessionIntentStoreAction("applyConfigIntentSettlement", state, next, {
        patchCount: plan.patches.length,
      }, debugStartedAtMs);
      return next;
    });
  },

  applyAdoptedSessionConfigIntentResolution: (plan) => {
    if (plan.patches.length === 0) {
      return;
    }
    const debugStartedAtMs = startSessionIntentStoreActionTrace();
    set((state) => {
      const next = withDispatchVersion(
        state,
        applyAdoptedSessionConfigIntentResolutionPlan(state, plan),
      );
      recordSessionIntentStoreAction(
        "applyAdoptedSessionConfigIntentResolution",
        state,
        next,
        { patchCount: plan.patches.length },
        debugStartedAtMs,
      );
      return next;
    });
  },

  reassignClientSession: (clientSessionId, nextClientSessionId) => {
    if (clientSessionId === nextClientSessionId) {
      return;
    }
    const debugStartedAtMs = startSessionIntentStoreActionTrace();
    set((state) => {
      const intents = sessionIntentsForSession(state, clientSessionId);
      if (intents.length === 0) {
        return state;
      }
      let next: SessionIntentStateShape = state;
      for (const intent of intents) {
        next = removeSessionIntent(next, intent.intentId);
        next = upsertSessionIntent(next, {
          ...intent,
          clientSessionId: nextClientSessionId,
        });
      }
      const versionedNext = withDispatchVersion(state, next);
      recordSessionIntentStoreAction("reassignClientSession", state, versionedNext, {
        clientSessionId,
        nextClientSessionId,
      }, debugStartedAtMs);
      return versionedNext;
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
