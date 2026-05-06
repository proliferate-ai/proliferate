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
import { parsePermissionOptionActions, type PermissionOptionAction } from "@/lib/domain/chat/chat-input-helpers";
import { resolveCurrentModeLabel } from "@/lib/domain/chat/chat-input";
import {
  hasVisibleTranscriptContent,
} from "@/lib/domain/chat/pending-prompts";
import { isSessionSlotBusy, resolveSessionViewState, type SessionViewState } from "@/lib/domain/sessions/activity";
import { getPendingSessionConfigChange, type PendingSessionConfigChanges } from "@/lib/domain/sessions/pending-config";
import {
  outboxEntriesForSession,
  outboxEntryToPendingPromptEntry,
  queuedOutboxEntriesForSession,
  renderableOutboxEntriesForTranscript,
  type PromptOutboxEntry,
} from "@/lib/domain/chat/prompt-outbox";
import { activitySnapshotFromDirectoryEntry, useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import type { SessionStreamConnectionState } from "@/stores/sessions/session-types";
import { usePromptOutboxStore } from "@/stores/chat/prompt-outbox-store";

const EMPTY_PENDING_PROMPTS: readonly PendingPromptEntry[] = [];
const EMPTY_PENDING_INTERACTIONS: readonly PendingInteraction[] = [];
const EMPTY_OUTBOX_ENTRIES: readonly PromptOutboxEntry[] = [];

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
  const outboxEntries = usePromptOutboxStore(useShallow((state) =>
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
      transcript,
    };
  }));
  const hasRenderableOutbox = usePromptOutboxStore((state) => {
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
  const outboxEntries = usePromptOutboxStore(useShallow((state) =>
    activeSessionId ? outboxEntriesForSession(state, activeSessionId) : EMPTY_OUTBOX_ENTRIES
  ));
  const outboxQueuedPrompts = useMemo(() => {
    const entries = outboxEntries;
    return entries.length > 0
      ? queuedOutboxEntriesForSession(entries).map(outboxEntryToPendingPromptEntry)
      : EMPTY_PENDING_PROMPTS;
  }, [outboxEntries]);
  return useMemo(() => {
    if (runtimePendingPrompts.length === 0) {
      return outboxQueuedPrompts;
    }
    if (outboxQueuedPrompts.length === 0) {
      return runtimePendingPrompts;
    }
    const runtimePromptIds = new Set(
      runtimePendingPrompts.map((entry) => entry.promptId).filter(Boolean),
    );
    return [
      ...runtimePendingPrompts,
      ...outboxQueuedPrompts.filter((entry) =>
        !entry.promptId || !runtimePromptIds.has(entry.promptId)
      ),
    ];
  }, [outboxQueuedPrompts, runtimePendingPrompts]);
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
  const slice = useSessionDirectoryStore(useShallow((state) => {
    const entry = activeSessionId ? state.entriesById[activeSessionId] ?? null : null;
    const modelControl = entry?.liveConfig?.normalizedControls.model ?? null;
    return {
      activeSessionId,
      agentKind: entry?.agentKind ?? null,
      modelId: entry?.modelId ?? null,
      pendingConfigChanges: entry?.pendingConfigChanges ?? null,
      currentModelConfigId: modelControl?.rawConfigId ?? null,
      modelControl,
    };
  }));

  const pendingModelId = useMemo(() => {
    if (!slice.pendingConfigChanges || !slice.currentModelConfigId) {
      return null;
    }
    return getPendingSessionConfigChange(
      slice.pendingConfigChanges,
      slice.currentModelConfigId,
    )?.value ?? null;
  }, [slice.currentModelConfigId, slice.pendingConfigChanges]);

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
  };
}

export function useActiveSessionConfigState() {
  const activeSessionId = useActiveSessionId();
  return useSessionDirectoryStore(useShallow((state) => {
    const entry = activeSessionId ? state.entriesById[activeSessionId] ?? null : null;
    return {
      agentKind: entry?.agentKind ?? null,
      materializedSessionId: entry?.materializedSessionId ?? null,
      modeId: entry?.modeId ?? null,
      workspaceId: entry?.workspaceId ?? null,
      normalizedControls: entry?.liveConfig?.normalizedControls ?? null,
      pendingConfigChanges: entry?.pendingConfigChanges ?? null,
    };
  }));
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
