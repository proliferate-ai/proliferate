import {
  selectPendingApprovalInteraction,
  selectPendingMcpElicitationInteraction,
  selectPendingUserInputInteraction,
  selectPrimaryPendingInteraction,
  type PendingInteraction,
  type PendingPromptEntry,
  type PromptCapabilities,
  type TranscriptState,
} from "@anyharness/sdk";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { parsePermissionOptionActions, type PermissionOptionAction } from "@/lib/domain/chat/composer/chat-input-helpers";
import { resolveCurrentModeLabel } from "@/lib/domain/chat/composer/chat-input";
import {
  hasVisibleTranscriptContent,
} from "@/lib/domain/chat/pending-prompts/pending-prompts";
import { isSessionSlotBusy, resolveSessionViewState, type SessionViewState } from "@/lib/domain/sessions/activity";
import { getPendingSessionConfigChange, type PendingSessionConfigChanges } from "@/lib/domain/sessions/pending-config";
import {
  pendingConfigChangesForSessionIntents,
  outboxEntryToPendingPromptEntry,
  projectPendingPromptsWithSessionIntents,
  queuedOutboxEntriesForSession,
  renderableOutboxEntriesForTranscript,
} from "@/lib/domain/sessions/intents/session-intent-selectors";
import type { PromptOutboxEntry } from "@/lib/domain/sessions/intents/session-intent-model";
import type { SessionIntent } from "@/lib/domain/sessions/intents/session-intent-model";
import {
  outboxEntriesForSession,
  sessionIntentsForSession,
} from "@/lib/domain/sessions/intents/session-intent-state";
import { activitySnapshotFromDirectoryEntry } from "@/lib/domain/sessions/directory/directory-activity";
import type { SessionStreamConnectionState } from "@/lib/domain/sessions/directory/directory-entry";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";

const EMPTY_PENDING_PROMPTS: readonly PendingPromptEntry[] = [];
const EMPTY_PENDING_INTERACTIONS: readonly PendingInteraction[] = [];
const EMPTY_OUTBOX_ENTRIES: readonly PromptOutboxEntry[] = [];
const EMPTY_SESSION_INTENTS: readonly SessionIntent[] = [];
const EMPTY_PENDING_CONFIG_CHANGES: PendingSessionConfigChanges = {};

// Owns read-only projections for the active chat session. Action hooks should
// consume these selectors rather than re-reading session stores ad hoc.
export interface ActiveLaunchIdentity {
  kind: string;
  modelId: string;
}

export function useActiveSessionId(): string | null {
  return useSessionSelectionStore((state) => state.activeSessionId);
}

export function useActiveSessionWorkspaceId(): string | null {
  const activeSessionId = useActiveSessionId();
  return useSessionDirectoryStore((state) =>
    activeSessionId ? state.entriesById[activeSessionId]?.workspaceId ?? null : null
  );
}

export function useActiveSessionPromptCapabilities(): PromptCapabilities | null {
  const activeSessionId = useActiveSessionId();
  return useSessionDirectoryStore((state) =>
    activeSessionId
      ? state.entriesById[activeSessionId]?.liveConfig?.promptCapabilities ?? null
      : null
  );
}

export function useActiveSessionRunningState(): boolean {
  const activeSessionId = useActiveSessionId();
  return useSessionDirectoryStore((state) =>
    activeSessionId
      ? isSessionSlotBusy(activitySnapshotFromDirectoryEntry(state.entriesById[activeSessionId]))
      : false
  );
}

export function useActiveSessionCanCancelState(): boolean {
  const activeSessionId = useActiveSessionId();
  return useSessionDirectoryStore((state) =>
    activeSessionId
      ? Boolean(state.entriesById[activeSessionId]?.materializedSessionId)
      : false
  );
}

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
  const intentDispatchVersion = useSessionIntentStore((state) => state.dispatchVersion);
  const outboxEntries = useMemo(
    () => activeSessionId
      ? outboxEntriesForSession(useSessionIntentStore.getState(), activeSessionId)
      : EMPTY_OUTBOX_ENTRIES,
    [activeSessionId, intentDispatchVersion],
  );
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

export function useActivePendingPrompts(): readonly PendingPromptEntry[] {
  const activeSessionId = useActiveSessionId();
  const runtimePendingPrompts = useSessionTranscriptStore((state) =>
    activeSessionId
      ? state.entriesById[activeSessionId]?.transcript?.pendingPrompts ?? EMPTY_PENDING_PROMPTS
      : EMPTY_PENDING_PROMPTS
  );
  const intentDispatchVersion = useSessionIntentStore((state) => state.dispatchVersion);
  const sessionIntents = useMemo(
    () => activeSessionId
      ? sessionIntentsForSession(useSessionIntentStore.getState(), activeSessionId)
      : EMPTY_SESSION_INTENTS,
    [activeSessionId, intentDispatchVersion],
  );
  const outboxEntries = useMemo(
    () => sessionIntents.filter((intent): intent is PromptOutboxEntry => intent.kind === "send_prompt"),
    [sessionIntents],
  );
  const outboxQueuedPrompts = useMemo(() => {
    const entries = outboxEntries;
    return entries.length > 0
      ? queuedOutboxEntriesForSession(entries).map(outboxEntryToPendingPromptEntry)
      : EMPTY_PENDING_PROMPTS;
  }, [outboxEntries]);
  return useMemo(() => {
    const projectedRuntimePendingPrompts = projectPendingPromptsWithSessionIntents(
      runtimePendingPrompts,
      sessionIntents,
    );
    if (projectedRuntimePendingPrompts.length === 0) {
      return outboxQueuedPrompts;
    }
    if (outboxQueuedPrompts.length === 0) {
      return projectedRuntimePendingPrompts;
    }
    const runtimePromptIds = new Set(
      projectedRuntimePendingPrompts.map((entry) => entry.promptId).filter(Boolean),
    );
    return [
      ...projectedRuntimePendingPrompts,
      ...outboxQueuedPrompts.filter((entry) =>
        !entry.promptId || !runtimePromptIds.has(entry.promptId)
      ),
    ];
  }, [outboxQueuedPrompts, runtimePendingPrompts, sessionIntents]);
}

export function useActivePendingInteractionState(): {
  pendingInteractions: readonly PendingInteraction[];
  pendingApproval: ReturnType<typeof selectPendingApprovalInteraction>;
  pendingUserInput: ReturnType<typeof selectPendingUserInputInteraction>;
  pendingMcpElicitation: ReturnType<typeof selectPendingMcpElicitationInteraction>;
  primaryPendingInteraction: ReturnType<typeof selectPrimaryPendingInteraction>;
} {
  const activeSessionId = useActiveSessionId();
  return useSessionTranscriptStore(useShallow((state) => {
    const transcript = activeSessionId
      ? state.entriesById[activeSessionId]?.transcript ?? null
      : null;
    return {
      pendingInteractions: transcript?.pendingInteractions ?? EMPTY_PENDING_INTERACTIONS,
      pendingApproval: transcript ? selectPendingApprovalInteraction(transcript) : null,
      pendingUserInput: transcript ? selectPendingUserInputInteraction(transcript) : null,
      pendingMcpElicitation: transcript ? selectPendingMcpElicitationInteraction(transcript) : null,
      primaryPendingInteraction: transcript ? selectPrimaryPendingInteraction(transcript) : null,
    };
  }));
}

export function useActivePendingApproval(): {
  pendingApproval: ReturnType<typeof selectPendingApprovalInteraction>;
  pendingApprovalActions: PermissionOptionAction[];
} {
  const pendingApproval = useActivePendingInteractionState().pendingApproval;
  const pendingApprovalActions = useMemo<PermissionOptionAction[]>(
    () => parsePermissionOptionActions(pendingApproval?.options),
    [pendingApproval?.options],
  );
  return { pendingApproval, pendingApprovalActions };
}

export function useActiveSessionLaunchState(): {
  activeSessionId: string | null;
  currentLaunchIdentity: ActiveLaunchIdentity | null;
  currentModelConfigId: string | null;
  pendingConfigChanges: PendingSessionConfigChanges | null;
  modelId: string | null;
  agentKind: string | null;
  modelControl: NonNullable<TranscriptState["liveConfig"]>["normalizedControls"]["model"] | null;
} {
  const activeSessionId = useActiveSessionId();
  const intentDispatchVersion = useSessionIntentStore((state) => state.dispatchVersion);
  const intentPendingConfigChanges = useMemo(
    () => activeSessionId
      ? pendingConfigChangesForSessionIntents(
          sessionIntentsForSession(useSessionIntentStore.getState(), activeSessionId),
        )
      : EMPTY_PENDING_CONFIG_CHANGES,
    [activeSessionId, intentDispatchVersion],
  );
  const slice = useSessionDirectoryStore(useShallow((state) => {
    const entry = activeSessionId ? state.entriesById[activeSessionId] ?? null : null;
    const modelControl = entry?.liveConfig?.normalizedControls.model ?? null;
    return {
      activeSessionId,
      agentKind: entry?.agentKind ?? null,
      modelId: entry?.modelId ?? null,
      directoryPendingConfigChanges: entry?.pendingConfigChanges ?? null,
      currentModelConfigId: modelControl?.rawConfigId ?? null,
      modelControl,
    };
  }));
  const pendingConfigChanges = useMemo(
    () => mergePendingConfigChanges(
      slice.directoryPendingConfigChanges,
      intentPendingConfigChanges,
    ),
    [intentPendingConfigChanges, slice.directoryPendingConfigChanges],
  );

  const pendingModelId = useMemo(() => {
    if (!slice.currentModelConfigId) {
      return null;
    }
    return getPendingSessionConfigChange(
      pendingConfigChanges,
      slice.currentModelConfigId,
    )?.value ?? null;
  }, [pendingConfigChanges, slice.currentModelConfigId]);

  const currentLaunchIdentity = useMemo<ActiveLaunchIdentity | null>(() => {
    if (!slice.agentKind) {
      return null;
    }
    const modelId = pendingModelId ?? slice.modelId ?? null;
    return modelId ? { kind: slice.agentKind, modelId } : null;
  }, [pendingModelId, slice.agentKind, slice.modelId]);

  return {
    ...slice,
    currentLaunchIdentity,
    pendingConfigChanges,
  };
}

export function useActiveSessionConfigState() {
  const activeSessionId = useActiveSessionId();
  const intentDispatchVersion = useSessionIntentStore((state) => state.dispatchVersion);
  const intentPendingConfigChanges = useMemo(
    () => activeSessionId
      ? pendingConfigChangesForSessionIntents(
          sessionIntentsForSession(useSessionIntentStore.getState(), activeSessionId),
        )
      : EMPTY_PENDING_CONFIG_CHANGES,
    [activeSessionId, intentDispatchVersion],
  );
  const slice = useSessionDirectoryStore(useShallow((state) => {
    const entry = activeSessionId ? state.entriesById[activeSessionId] ?? null : null;
    return {
      agentKind: entry?.agentKind ?? null,
      materializedSessionId: entry?.materializedSessionId ?? null,
      modeId: entry?.modeId ?? null,
      workspaceId: entry?.workspaceId ?? null,
      normalizedControls: entry?.liveConfig?.normalizedControls ?? null,
      directoryPendingConfigChanges: entry?.pendingConfigChanges ?? null,
    };
  }));
  const pendingConfigChanges = useMemo(
    () => mergePendingConfigChanges(
      slice.directoryPendingConfigChanges,
      intentPendingConfigChanges,
    ),
    [intentPendingConfigChanges, slice.directoryPendingConfigChanges],
  );
  return {
    ...slice,
    pendingConfigChanges,
  };
}

export function useActiveSessionModeState(): {
  currentModeId: string | null;
  currentModeLabel: string | null;
} {
  const activeSessionId = useActiveSessionId();
  const directory = useSessionDirectoryStore((state) =>
    activeSessionId ? state.entriesById[activeSessionId] ?? null : null
  );
  return useSessionTranscriptStore(useShallow((state) => {
    const transcript = activeSessionId ? state.entriesById[activeSessionId]?.transcript ?? null : null;
    return {
      currentModeId: transcript?.currentModeId ?? directory?.modeId ?? null,
      currentModeLabel: resolveCurrentModeLabel(directory
        ? {
          modeId: directory.modeId,
          transcript,
          liveConfig: directory.liveConfig,
        }
        : null),
    };
  }));
}

function mergePendingConfigChanges(
  directoryPendingConfigChanges: PendingSessionConfigChanges | null | undefined,
  intentPendingConfigChanges: PendingSessionConfigChanges,
): PendingSessionConfigChanges | null {
  const hasDirectoryChanges = directoryPendingConfigChanges
    ? Object.keys(directoryPendingConfigChanges).length > 0
    : false;
  const hasIntentChanges = Object.keys(intentPendingConfigChanges).length > 0;
  if (!hasDirectoryChanges && !hasIntentChanges) {
    return null;
  }
  if (!hasDirectoryChanges) {
    return intentPendingConfigChanges;
  }
  if (!hasIntentChanges) {
    return directoryPendingConfigChanges ?? null;
  }
  return {
    ...directoryPendingConfigChanges,
    ...intentPendingConfigChanges,
  };
}
