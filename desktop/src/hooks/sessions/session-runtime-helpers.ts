import type { SessionStreamHandle } from "@anyharness/sdk";
import { resolveSessionViewState } from "@/lib/domain/sessions/activity";
import { isPendingSessionId } from "@/lib/workflows/sessions/session-runtime";
import { isCurrentSessionStreamHandle } from "@/lib/access/anyharness/session-stream-handles";
import {
  activitySnapshotFromDirectoryEntry,
  useSessionDirectoryStore,
} from "@/stores/sessions/session-directory-store";

export function shouldReconnectStream(sessionId: string): boolean {
  const entry = useSessionDirectoryStore.getState().entriesById[sessionId];
  if (!entry || isPendingSessionId(sessionId)) {
    return false;
  }

  const viewState = resolveSessionViewState(activitySnapshotFromDirectoryEntry(entry));
  return viewState === "working" || viewState === "needs_input";
}

export function isCurrentStreamHandle(
  sessionId: string,
  handle: SessionStreamHandle,
): boolean {
  return isCurrentSessionStreamHandle(sessionId, handle);
}
