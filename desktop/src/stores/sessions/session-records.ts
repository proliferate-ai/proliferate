import {
  createTranscriptState,
  type PendingPromptEntry,
  type Session,
  type SessionActionCapabilities,
  type SessionExecutionSummary,
  type SessionLiveConfigSnapshot,
  type SessionMcpBindingSummary,
} from "@anyharness/sdk";
import { resolveStatusFromExecutionSummary } from "@/lib/domain/sessions/activity";
import type { PendingSessionConfigChanges } from "@/lib/domain/sessions/pending-config";
import {
  activityFromTranscript,
  createDirectoryEntry,
  useSessionDirectoryStore,
} from "@/stores/sessions/session-directory-store";
import {
  useSessionTranscriptStore,
} from "@/stores/sessions/session-transcript-store";
import type {
  SessionDirectoryEntry,
  SessionRelationship,
  SessionRuntimeRecord,
  SessionTranscriptEntry,
} from "@/stores/sessions/session-types";
import {
  DEFAULT_SESSION_ACTION_CAPABILITIES,
} from "@/stores/sessions/session-types";
import { batchSessionStoreWrites } from "@/lib/infra/react-batching";

// Imperative facade over the split session stores. The underlying stores stay
// single-purpose; workflow hooks use this module when a logical session record
// needs coordinated directory + transcript updates in one React batch.
export function createEmptySessionRecord(
  sessionId: string,
  agentKind: string,
  config?: {
    workspaceId?: string | null;
    materializedSessionId?: string | null;
    modelId?: string | null;
    modeId?: string | null;
    title?: string | null;
    actionCapabilities?: SessionActionCapabilities | null;
    liveConfig?: SessionLiveConfigSnapshot | null;
    executionSummary?: SessionExecutionSummary | null;
    mcpBindingSummaries?: SessionMcpBindingSummary[] | null;
    lastPromptAt?: string | null;
    optimisticPrompt?: PendingPromptEntry | null;
    pendingConfigChanges?: PendingSessionConfigChanges;
    sessionRelationship?: SessionRelationship;
  },
): SessionRuntimeRecord {
  const resolvedModeId =
    config?.liveConfig?.normalizedControls.mode?.currentValue ?? config?.modeId ?? null;
  const title = config?.title?.trim() || null;
  const transcript = {
    ...createTranscriptState(sessionId),
    currentModeId: resolvedModeId,
    sessionMeta: {
      ...createTranscriptState(sessionId).sessionMeta,
      title,
    },
  };
  const directory = createDirectoryEntry({
    sessionId,
    materializedSessionId:
      config?.materializedSessionId !== undefined
        ? config.materializedSessionId
        : sessionId,
    workspaceId: config?.workspaceId ?? null,
    agentKind,
    modelId: config?.modelId ?? null,
    modeId: resolvedModeId,
    title,
    actionCapabilities: config?.actionCapabilities ?? DEFAULT_SESSION_ACTION_CAPABILITIES,
    liveConfig: config?.liveConfig ?? null,
    executionSummary: config?.executionSummary ?? null,
    mcpBindingSummaries: config?.mcpBindingSummaries ?? null,
    pendingConfigChanges: config?.pendingConfigChanges ?? {},
    lastPromptAt: config?.lastPromptAt ?? null,
    sessionRelationship: config?.sessionRelationship ?? { kind: "pending" },
    activity: activityFromTranscript(transcript),
  });
  const transcriptEntry: SessionTranscriptEntry = {
    sessionId,
    events: [],
    transcript,
    optimisticPrompt: config?.optimisticPrompt ?? null,
  };
  return combineSessionRecord(directory, transcriptEntry)!;
}

export function createSessionRecordFromSummary(
  session: Session,
  workspaceId: string,
  options?: {
    titleFallback?: string | null;
    transcriptHydrated?: boolean;
    sessionRelationship?: SessionRelationship;
  },
): SessionRuntimeRecord {
  const modeId =
    session.liveConfig?.normalizedControls.mode?.currentValue
    ?? session.modeId
    ?? null;
  const title = session.title?.trim() || options?.titleFallback?.trim() || null;
  const record = createEmptySessionRecord(session.id, session.agentKind, {
    workspaceId,
    materializedSessionId: session.id,
    modelId: session.modelId ?? null,
    modeId,
    title,
    actionCapabilities: session.actionCapabilities,
    liveConfig: session.liveConfig ?? null,
    executionSummary: session.executionSummary ?? null,
    mcpBindingSummaries: session.mcpBindingSummaries ?? null,
    lastPromptAt: session.lastPromptAt ?? null,
    sessionRelationship: options?.sessionRelationship ?? { kind: "pending" },
  });
  const status = resolveStatusFromExecutionSummary(
    session.executionSummary,
    session.status ?? "idle",
  );
  return {
    ...record,
    status,
    transcriptHydrated: options?.transcriptHydrated ?? false,
    activity: activityFromTranscript(record.transcript, {
      status,
      executionSummary: session.executionSummary ?? null,
    }),
  };
}

export function putSessionRecord(record: SessionRuntimeRecord): void {
  useSessionDirectoryStore.getState().putEntry(record);
  useSessionTranscriptStore.getState().putEntry({
    sessionId: record.sessionId,
    events: record.events,
    transcript: record.transcript,
    optimisticPrompt: record.optimisticPrompt,
  });
}

export function patchSessionRecord(
  sessionId: string,
  patch: Partial<SessionRuntimeRecord>,
): void {
  batchSessionStoreWrites(() => {
    const directoryPatch: Partial<SessionDirectoryEntry> = {};
    if ("materializedSessionId" in patch) {
      directoryPatch.materializedSessionId = patch.materializedSessionId ?? null;
    }
    if ("workspaceId" in patch) directoryPatch.workspaceId = patch.workspaceId ?? null;
    if ("agentKind" in patch && patch.agentKind) directoryPatch.agentKind = patch.agentKind;
    if ("modelId" in patch) directoryPatch.modelId = patch.modelId ?? null;
    if ("modeId" in patch) directoryPatch.modeId = patch.modeId ?? null;
    if ("title" in patch) directoryPatch.title = patch.title ?? null;
    if ("actionCapabilities" in patch && patch.actionCapabilities) {
      directoryPatch.actionCapabilities = patch.actionCapabilities;
    }
    if ("liveConfig" in patch) directoryPatch.liveConfig = patch.liveConfig ?? null;
    if ("executionSummary" in patch) directoryPatch.executionSummary = patch.executionSummary ?? null;
    if ("mcpBindingSummaries" in patch) {
      directoryPatch.mcpBindingSummaries = patch.mcpBindingSummaries ?? null;
    }
    if ("pendingConfigChanges" in patch && patch.pendingConfigChanges) {
      directoryPatch.pendingConfigChanges = patch.pendingConfigChanges;
    }
    if ("status" in patch) directoryPatch.status = patch.status ?? null;
    if ("lastPromptAt" in patch) directoryPatch.lastPromptAt = patch.lastPromptAt ?? null;
    if ("streamConnectionState" in patch && patch.streamConnectionState) {
      directoryPatch.streamConnectionState = patch.streamConnectionState;
    }
    if ("transcriptHydrated" in patch && patch.transcriptHydrated !== undefined) {
      directoryPatch.transcriptHydrated = patch.transcriptHydrated;
    }
    if ("sessionRelationship" in patch && patch.sessionRelationship) {
      directoryPatch.sessionRelationship = patch.sessionRelationship;
    }

    if (Object.keys(directoryPatch).length > 0) {
      useSessionDirectoryStore.getState().patchEntry(sessionId, directoryPatch);
    }
    if ("events" in patch || "transcript" in patch || "optimisticPrompt" in patch) {
      const transcriptPatch: Partial<Omit<SessionTranscriptEntry, "sessionId">> = {};
      if ("events" in patch) {
        transcriptPatch.events = patch.events;
      }
      if ("transcript" in patch) {
        transcriptPatch.transcript = patch.transcript;
      }
      if ("optimisticPrompt" in patch) {
        transcriptPatch.optimisticPrompt = patch.optimisticPrompt;
      }
      useSessionTranscriptStore.getState().patchEntry(sessionId, transcriptPatch);
    }
    if (patch.transcript || "status" in patch || "executionSummary" in patch) {
      const transcript =
        patch.transcript
        ?? useSessionTranscriptStore.getState().entriesById[sessionId]?.transcript
        ?? null;
      if (transcript) {
        useSessionDirectoryStore.getState().patchActivityFromTranscript(sessionId, transcript);
      }
    }
  });
}

export function removeSessionRecord(sessionId: string): void {
  useSessionDirectoryStore.getState().removeEntry(sessionId);
  useSessionTranscriptStore.getState().removeEntry(sessionId);
}

export function getSessionRecord(sessionId: string): SessionRuntimeRecord | null {
  return combineSessionRecord(
    useSessionDirectoryStore.getState().entriesById[sessionId] ?? null,
    useSessionTranscriptStore.getState().entriesById[sessionId] ?? null,
  );
}

export function findClientSessionIdByMaterializedSessionId(
  materializedSessionId: string | null | undefined,
): string | null {
  if (!materializedSessionId) {
    return null;
  }
  return useSessionDirectoryStore.getState()
    .clientSessionIdByMaterializedSessionId[materializedSessionId] ?? null;
}

export function getMaterializedSessionId(
  clientSessionId: string | null | undefined,
): string | null {
  if (!clientSessionId) {
    return null;
  }
  return useSessionDirectoryStore.getState().entriesById[clientSessionId]?.materializedSessionId
    ?? null;
}

export function requireMaterializedSessionId(clientSessionId: string): string {
  const materializedSessionId = getMaterializedSessionId(clientSessionId);
  if (!materializedSessionId) {
    throw new Error("Session is still starting. Try again in a moment.");
  }
  return materializedSessionId;
}

export function isSessionMaterialized(clientSessionId: string | null | undefined): boolean {
  return !!getMaterializedSessionId(clientSessionId);
}

export function waitForSessionMaterialization(
  clientSessionId: string,
  timeoutMs = 15_000,
): Promise<string> {
  const existing = getMaterializedSessionId(clientSessionId);
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => {};
    const timeout = globalThis.setTimeout(() => {
      unsubscribe();
      reject(new Error("Session is still starting. Try again in a moment."));
    }, timeoutMs);
    unsubscribe = useSessionDirectoryStore.subscribe((state) => {
      const materializedSessionId = state.entriesById[clientSessionId]?.materializedSessionId
        ?? null;
      if (!materializedSessionId) {
        return;
      }
      globalThis.clearTimeout(timeout);
      unsubscribe();
      resolve(materializedSessionId);
    });
  });
}

export function getSessionRecordByMaterializedSessionId(
  materializedSessionId: string | null | undefined,
): SessionRuntimeRecord | null {
  const clientSessionId = findClientSessionIdByMaterializedSessionId(materializedSessionId);
  return clientSessionId ? getSessionRecord(clientSessionId) : null;
}

export function getSessionRecords(): Record<string, SessionRuntimeRecord> {
  const directoryEntries = useSessionDirectoryStore.getState().entriesById;
  const transcriptEntries = useSessionTranscriptStore.getState().entriesById;
  return Object.fromEntries(
    Object.entries(directoryEntries).flatMap(([sessionId, directory]) => {
      const record = combineSessionRecord(
        directory,
        transcriptEntries[sessionId] ?? null,
      );
      return record ? [[sessionId, record]] : [];
    }),
  );
}

export function getWorkspaceSessionRecords(
  workspaceId: string | null | undefined,
): Record<string, SessionRuntimeRecord> {
  if (!workspaceId) {
    return {};
  }
  const directoryState = useSessionDirectoryStore.getState();
  const transcriptEntries = useSessionTranscriptStore.getState().entriesById;
  return Object.fromEntries(
    (directoryState.sessionIdsByWorkspaceId[workspaceId] ?? []).flatMap((sessionId) => {
      const record = combineSessionRecord(
        directoryState.entriesById[sessionId] ?? null,
        transcriptEntries[sessionId] ?? null,
      );
      return record ? [[sessionId, record]] : [];
    }),
  );
}

export function combineSessionRecord(
  directory: SessionDirectoryEntry | null | undefined,
  transcriptEntry: SessionTranscriptEntry | null | undefined,
): SessionRuntimeRecord | null {
  if (!directory || !transcriptEntry) {
    return null;
  }
  return {
    ...directory,
    events: transcriptEntry.events,
    transcript: transcriptEntry.transcript,
    optimisticPrompt: transcriptEntry.optimisticPrompt,
  };
}

export function ensureSessionTranscriptEntry(sessionId: string): SessionTranscriptEntry {
  return useSessionTranscriptStore.getState().ensureEntry(
    sessionId,
    createTranscriptState(sessionId),
  );
}
