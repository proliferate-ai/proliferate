import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { resolveSessionSidebarActivityState } from "@/lib/domain/sessions/activity";
import {
  activitySnapshotFromDirectoryEntry,
  useSessionDirectoryStore,
} from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import { isHotSessionClientId } from "@/lib/integrations/anyharness/hot-session-ingest-manager";

const ACTIVITY_RECONCILE_DELAY_MS = 5_000;
const ACTIVITY_RECONCILE_MAX_SESSION_COUNT = 8;

export function useSessionActivityReconciler() {
  const { refreshSessionSlotMeta } = useSessionRuntimeActions();
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const activeSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const activeSessionIds = useSessionDirectoryStore(useShallow((state) =>
    collectBoundedActivityReconciliationIds({
      state,
      selectedWorkspaceId,
      activeSessionId,
    })
  ));

  useEffect(() => {
    if (activeSessionIds.length === 0) {
      return;
    }

    let cancelled = false;
    let refreshInFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = (delayMs = ACTIVITY_RECONCILE_DELAY_MS) => {
      if (cancelled) {
        return;
      }
      timer = setTimeout(runRefresh, delayMs);
    };

    const runRefresh = () => {
      timer = null;
      if (cancelled) {
        return;
      }
      if (refreshInFlight) {
        scheduleRefresh();
        return;
      }

      refreshInFlight = true;
      void Promise.allSettled(
        activeSessionIds.map((sessionId) =>
          refreshSessionSlotMeta(sessionId, { resumeIfActive: false })
        ),
      ).finally(() => {
        refreshInFlight = false;
        scheduleRefresh();
      });
    };

    scheduleRefresh(0);

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [activeSessionIds, refreshSessionSlotMeta]);
}

type SessionDirectoryStoreSnapshot = Pick<
  ReturnType<typeof useSessionDirectoryStore.getState>,
  "entriesById" | "sessionIdsByWorkspaceId"
>;

function collectBoundedActivityReconciliationIds({
  state,
  selectedWorkspaceId,
  activeSessionId,
}: {
  state: SessionDirectoryStoreSnapshot;
  selectedWorkspaceId: string | null;
  activeSessionId: string | null;
}): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const maybePush = (sessionId: string | null | undefined) => {
    if (
      !sessionId
      || seen.has(sessionId)
      || ids.length >= ACTIVITY_RECONCILE_MAX_SESSION_COUNT
    ) {
      return;
    }
    if (isHotSessionClientId(sessionId)) {
      return;
    }
    const entry = state.entriesById[sessionId];
    if (!entry?.materializedSessionId) {
      return;
    }
    const snapshot = activitySnapshotFromDirectoryEntry(entry);
    if (!snapshot) {
      return;
    }
    const sidebarState = resolveSessionSidebarActivityState(snapshot);
    if (
      sidebarState !== "iterating"
      && sidebarState !== "waiting_input"
      && sidebarState !== "waiting_plan"
    ) {
      return;
    }
    seen.add(sessionId);
    ids.push(sessionId);
  };

  maybePush(activeSessionId);
  if (selectedWorkspaceId) {
    for (const sessionId of state.sessionIdsByWorkspaceId[selectedWorkspaceId] ?? []) {
      maybePush(sessionId);
    }
  }
  for (const sessionId of Object.keys(state.entriesById)) {
    maybePush(sessionId);
    if (ids.length >= ACTIVITY_RECONCILE_MAX_SESSION_COUNT) {
      break;
    }
  }

  return ids.sort();
}
