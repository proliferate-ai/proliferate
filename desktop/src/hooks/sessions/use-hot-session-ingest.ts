import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  resolveHotSessionTargets,
} from "@/lib/domain/sessions/hot-session-policy";
import {
  reconcileHotSessions,
  type HotSessionIngestManagerDeps,
} from "@/lib/workflows/sessions/hot-session-ingest-manager";
import { resolveSelectedWorkspaceIdentity } from "@/lib/domain/workspaces/selection/workspace-ui-key";
import { resolveWithWorkspaceFallback } from "@/lib/domain/workspaces/selection/workspace-keyed-preferences";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { isHotSessionTargetCurrent, useSessionIngestStore } from "@/stores/sessions/session-ingest-store";
import { getSessionRecord } from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";

const EMPTY_SESSION_IDS: readonly string[] = [];

export function useHotSessionIngest(): void {
  const {
    activeSessionId,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
  } = useSessionSelectionStore(useShallow((state) => ({
    activeSessionId: state.activeSessionId,
    selectedLogicalWorkspaceId: state.selectedLogicalWorkspaceId,
    selectedWorkspaceId: state.selectedWorkspaceId,
  })));
  const { workspaceUiKey, materializedWorkspaceId } = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });
  const visibleChatSessionIds = useWorkspaceUiStore((state) =>
    resolveWithWorkspaceFallback(
      state.visibleChatSessionIdsByWorkspace,
      workspaceUiKey,
      materializedWorkspaceId,
    ).value ?? EMPTY_SESSION_IDS
  );
  const workspaceSessionIds = useSessionDirectoryStore((state) =>
    selectedWorkspaceId
      ? state.sessionIdsByWorkspaceId[selectedWorkspaceId] ?? EMPTY_SESSION_IDS
      : EMPTY_SESSION_IDS
  );
  const relevantSessionIds = useMemo(() =>
    uniqueSessionIds([
      activeSessionId,
      ...visibleChatSessionIds,
      ...workspaceSessionIds,
    ]), [
    activeSessionId,
    visibleChatSessionIds,
    workspaceSessionIds,
  ]);
  const directoryEntriesById = useSessionDirectoryStore(useShallow((state) =>
    Object.fromEntries(
      relevantSessionIds.map((sessionId) => [sessionId, state.entriesById[sessionId]]),
    )
  ));
  const promptActivityBySessionId = useSessionTranscriptStore(useShallow((state) =>
    Object.fromEntries(
      relevantSessionIds.map((sessionId) => {
        const entry = state.entriesById[sessionId];
        return [
          sessionId,
          (entry?.optimisticPrompt ? 1 : 0)
            + (entry?.transcript.pendingPrompts.length ?? 0),
        ];
      }),
    )
  ));
  const targets = useMemo(() => resolveHotSessionTargets({
    activeSessionId,
    directoryEntriesById,
    promptActivityBySessionId,
    selectedWorkspaceId,
    visibleChatSessionIds,
    workspaceSessionIds,
  }), [
    activeSessionId,
    directoryEntriesById,
    promptActivityBySessionId,
    selectedWorkspaceId,
    visibleChatSessionIds,
    workspaceSessionIds,
  ]);
  const {
    closeSessionSlotStream,
    ensureSessionStreamConnected,
  } = useSessionRuntimeActions();
  const managerDeps = useMemo<HotSessionIngestManagerDeps>(() => ({
    closeSessionSlotStream,
    ensureSessionStreamConnected,
    state: {
      setHotTargets: (nextTargets) => useSessionIngestStore.getState().setHotTargets(nextTargets),
      markWarming: (clientSessionId) => useSessionIngestStore.getState().markWarming(clientSessionId),
      markCurrentIfContiguous: (clientSessionId, lastAppliedSeq) =>
        useSessionIngestStore.getState().markCurrentIfContiguous(clientSessionId, lastAppliedSeq),
      markStale: (clientSessionId, patch) =>
        useSessionIngestStore.getState().markStale(clientSessionId, patch),
      markCold: (clientSessionId) => useSessionIngestStore.getState().markCold(clientSessionId),
      getFreshness: (clientSessionId) =>
        useSessionIngestStore.getState().freshnessByClientSessionId[clientSessionId]?.freshness ?? null,
      isTargetCurrent: (clientSessionId, generation, materializedSessionId) =>
        isHotSessionTargetCurrent(clientSessionId, generation, materializedSessionId),
      getSessionRecord: (clientSessionId) => {
        const record = getSessionRecord(clientSessionId);
        return record
          ? {
            streamConnectionState: record.streamConnectionState,
            lastSeq: record.transcript.lastSeq,
          }
          : null;
      },
    },
  }), [closeSessionSlotStream, ensureSessionStreamConnected]);
  const managerDepsRef = useRef(managerDeps);
  managerDepsRef.current = managerDeps;

  useEffect(() => {
    reconcileHotSessions(targets, managerDeps);
  }, [managerDeps, targets]);

  useEffect(() => () => {
    reconcileHotSessions([], managerDepsRef.current);
  }, []);
}

function uniqueSessionIds(ids: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}
