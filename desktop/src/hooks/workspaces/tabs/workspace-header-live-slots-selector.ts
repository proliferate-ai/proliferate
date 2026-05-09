import type { SessionDirectoryEntry } from "@/stores/sessions/session-types";

type SessionDirectoryStoreSnapshot = {
  entriesById: Record<string, SessionDirectoryEntry>;
  sessionIdsByWorkspaceId: Record<string, readonly string[]>;
};

const EMPTY_LIVE_SLOTS: SessionDirectoryEntry[] = [];

export function createWorkspaceHeaderLiveSlotsSelector(
  workspaceId: string | null,
): (state: SessionDirectoryStoreSnapshot) => SessionDirectoryEntry[] {
  let previousSignature = "";
  let previousSlots = EMPTY_LIVE_SLOTS;

  return (state) => {
    if (!workspaceId) {
      previousSignature = "";
      previousSlots = EMPTY_LIVE_SLOTS;
      return EMPTY_LIVE_SLOTS;
    }

    const signature = buildWorkspaceHeaderLiveSlotsSignature(
      state.entriesById,
      state.sessionIdsByWorkspaceId,
      workspaceId,
    );
    if (signature === previousSignature) {
      return previousSlots;
    }

    previousSignature = signature;
    previousSlots = (state.sessionIdsByWorkspaceId[workspaceId] ?? [])
      .map((sessionId) => state.entriesById[sessionId])
      .filter((slot): slot is SessionDirectoryEntry => !!slot);
    return previousSlots;
  };
}

function buildWorkspaceHeaderLiveSlotsSignature(
  entriesById: Record<string, SessionDirectoryEntry>,
  sessionIdsByWorkspaceId: Record<string, readonly string[]>,
  workspaceId: string,
): string {
  let signature = "";
  for (const sessionId of sessionIdsByWorkspaceId[workspaceId] ?? []) {
    const slot = entriesById[sessionId];
    if (!slot) {
      continue;
    }
    signature += buildHeaderSlotSignature(slot);
    signature += "\u001e";
  }
  return signature;
}

function buildHeaderSlotSignature(slot: SessionDirectoryEntry): string {
  return [
    slot.sessionId,
    slot.materializedSessionId ?? "",
    slot.workspaceId ?? "",
    slot.agentKind,
    slot.title ?? "",
    slot.status ?? "",
    slot.executionSummary?.phase ?? "",
    pendingInteractionSignature(slot.executionSummary?.pendingInteractions),
    slot.streamConnectionState,
    slot.activity.isStreaming ? "streaming" : "idle",
    slot.activity.transcriptTitle ?? "",
    pendingInteractionSignature(slot.activity.pendingInteractions),
    slot.actionCapabilities.fork ? "fork" : "no-fork",
  ].join("\u001f");
}

function pendingInteractionSignature(
  interactions: readonly HeaderPendingInteraction[] | null | undefined,
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

interface HeaderPendingInteraction {
  requestId?: string;
  linkedPlanId?: string | null;
  source?: {
    linkedPlanId?: string | null;
  } | null;
}
