import { useMemo } from "react";
import {
  collectWorkspaceSidebarActivityStates,
  collectWorkspaceSidebarActivityStatesWithErrorAttention,
  resolveSessionErrorAttentionKey,
  type SidebarSessionActivityState,
} from "@/lib/domain/sessions/activity";
import { useHarnessStore, type SessionSlot } from "@/stores/sessions/harness-store";

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
  return useHarnessStore(selector);
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
  return useHarnessStore(selector);
}

type HarnessStoreSnapshot = ReturnType<typeof useHarnessStore.getState>;

function createWorkspaceSidebarActivitySelector({
  includeErrorAttention,
  lastViewedSessionErrorAtBySession,
}: {
  includeErrorAttention: boolean;
  lastViewedSessionErrorAtBySession: Record<string, string>;
}): (state: HarnessStoreSnapshot) => Record<string, SidebarSessionActivityState> {
  let previousSignature = "";
  let previousStates = EMPTY_ACTIVITY_STATES;

  return (state) => {
    const signature = buildWorkspaceSidebarActivitySignature(
      state.sessionSlots,
      includeErrorAttention,
    );
    if (signature === previousSignature) {
      return previousStates;
    }

    previousSignature = signature;
    previousStates = includeErrorAttention
      ? collectWorkspaceSidebarActivityStatesWithErrorAttention(
          toSidebarAttentionSnapshots(state.sessionSlots),
          lastViewedSessionErrorAtBySession,
        )
      : collectWorkspaceSidebarActivityStates(toSidebarActivitySnapshots(state.sessionSlots));
    return previousStates;
  };
}

function buildWorkspaceSidebarActivitySignature(
  sessionSlots: Record<string, SessionSlot>,
  includeErrorAttention: boolean,
): string {
  let signature = "";
  for (const slot of Object.values(sessionSlots)) {
    signature += [
      slot.sessionId,
      slot.workspaceId ?? "",
      slot.status ?? "",
      slot.executionSummary?.phase ?? "",
      pendingInteractionSignature(slot.executionSummary?.pendingInteractions),
      slot.streamConnectionState,
      slot.transcript.isStreaming ? "streaming" : "idle",
      pendingInteractionSignature(slot.transcript.pendingInteractions),
      includeErrorAttention ? resolveSessionErrorAttentionKey(slot) ?? "" : "",
    ].join("\u001f");
    signature += "\u001e";
  }
  return signature;
}

function toSidebarActivitySnapshots(sessionSlots: Record<string, SessionSlot>) {
  return Object.fromEntries(
    Object.entries(sessionSlots).map(([sessionId, slot]) => [
      sessionId,
      {
        workspaceId: slot.workspaceId,
        status: slot.status,
        executionSummary: slot.executionSummary,
        streamConnectionState: slot.streamConnectionState,
        transcript: {
          isStreaming: slot.transcript.isStreaming,
          pendingInteractions: slot.transcript.pendingInteractions,
        },
      },
    ]),
  );
}

function toSidebarAttentionSnapshots(sessionSlots: Record<string, SessionSlot>) {
  return Object.fromEntries(
    Object.entries(sessionSlots).map(([sessionId, slot]) => [
      sessionId,
      {
        sessionId: slot.sessionId,
        workspaceId: slot.workspaceId,
        status: slot.status,
        executionSummary: slot.executionSummary,
        streamConnectionState: slot.streamConnectionState,
        transcript: {
          isStreaming: slot.transcript.isStreaming,
          pendingInteractions: slot.transcript.pendingInteractions,
        },
        errorAttentionKey: resolveSessionErrorAttentionKey(slot),
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
