import { useMemo } from "react";
import {
  collectWorkspaceSidebarActivityStates,
  collectWorkspaceSidebarActivityStatesWithErrorAttention,
  type SidebarSessionActivityState,
} from "@/lib/domain/sessions/activity";
import {
  activitySnapshotFromDirectoryEntry,
  useSessionDirectoryStore,
} from "@/stores/sessions/session-directory-store";
import type { SessionDirectoryEntry } from "@/stores/sessions/session-types";

const EMPTY_ACTIVITY_STATES: Record<string, SidebarSessionActivityState> = {};
const EMPTY_LAST_VIEWED_SESSION_ERROR_AT_BY_SESSION: Record<string, string> = {};

export function useWorkspaceSidebarActivityStates(): Record<string, SidebarSessionActivityState> {
  const selector = useMemo(
    () => createWorkspaceSidebarActivitySelector({
      includeErrorAttention: false,
      lastViewedSessionErrorAtBySession: EMPTY_LAST_VIEWED_SESSION_ERROR_AT_BY_SESSION,
    }),
    [],
  );
  return useSessionDirectoryStore(selector);
}

export function useWorkspaceSidebarActivityStatesWithErrorAttention(
  lastViewedSessionErrorAtBySession:
    Record<string, string> | null | undefined,
): Record<string, SidebarSessionActivityState> {
  const lastViewed =
    lastViewedSessionErrorAtBySession ?? EMPTY_LAST_VIEWED_SESSION_ERROR_AT_BY_SESSION;
  const selector = useMemo(
    () => createWorkspaceSidebarActivitySelector({
      includeErrorAttention: true,
      lastViewedSessionErrorAtBySession: lastViewed,
    }),
    [lastViewed],
  );
  return useSessionDirectoryStore(selector);
}

type DirectoryStoreSnapshot = ReturnType<typeof useSessionDirectoryStore.getState>;

function createWorkspaceSidebarActivitySelector({
  includeErrorAttention,
  lastViewedSessionErrorAtBySession,
}: {
  includeErrorAttention: boolean;
  lastViewedSessionErrorAtBySession: Record<string, string>;
}): (state: DirectoryStoreSnapshot) => Record<string, SidebarSessionActivityState> {
  let previousSignature = "";
  let previousStates = EMPTY_ACTIVITY_STATES;

  return (state) => {
    const signature = buildWorkspaceSidebarActivitySignature(
      state.entriesById,
      includeErrorAttention,
    );
    if (signature === previousSignature) {
      return previousStates;
    }

    previousSignature = signature;
    previousStates = includeErrorAttention
      ? collectWorkspaceSidebarActivityStatesWithErrorAttention(
          toSidebarAttentionSnapshots(state.entriesById),
          lastViewedSessionErrorAtBySession,
        )
      : collectWorkspaceSidebarActivityStates(toSidebarActivitySnapshots(state.entriesById));
    return previousStates;
  };
}

function buildWorkspaceSidebarActivitySignature(
  entriesById: Record<string, SessionDirectoryEntry>,
  includeErrorAttention: boolean,
): string {
  let signature = "";
  for (const entry of Object.values(entriesById)) {
    signature += [
      entry.sessionId,
      entry.workspaceId ?? "",
      entry.status ?? "",
      entry.executionSummary?.phase ?? "",
      pendingInteractionSignature(entry.executionSummary?.pendingInteractions),
      entry.streamConnectionState,
      entry.activity.isStreaming ? "streaming" : "idle",
      pendingInteractionSignature(entry.activity.pendingInteractions),
      includeErrorAttention ? entry.activity.errorAttentionKey ?? "" : "",
    ].join("\u001f");
    signature += "\u001e";
  }
  return signature;
}

function toSidebarActivitySnapshots(entriesById: Record<string, SessionDirectoryEntry>) {
  return Object.fromEntries(
    Object.entries(entriesById).map(([sessionId, entry]) => [
      sessionId,
      {
        workspaceId: entry.workspaceId,
        ...activitySnapshotFromDirectoryEntry(entry)!,
      },
    ]),
  );
}

function toSidebarAttentionSnapshots(entriesById: Record<string, SessionDirectoryEntry>) {
  return Object.fromEntries(
    Object.entries(entriesById).map(([sessionId, entry]) => [
      sessionId,
      {
        sessionId: entry.sessionId,
        workspaceId: entry.workspaceId,
        ...activitySnapshotFromDirectoryEntry(entry)!,
        errorAttentionKey: entry.activity.errorAttentionKey,
      },
    ]),
  );
}

function pendingInteractionSignature(
  interactions: readonly SidebarPendingInteraction[] | null | undefined,
): string {
  if (!interactions || interactions.length === 0) {
    return "";
  }
  return interactions
    .map((interaction) => [
      interaction.requestId ?? "",
      interaction.linkedPlanId ?? "",
      interaction.source?.linkedPlanId ?? "",
    ].join(":"))
    .join(",");
}

interface SidebarPendingInteraction {
  requestId?: string;
  linkedPlanId?: string | null;
  source?: {
    linkedPlanId?: string | null;
  } | null;
}
