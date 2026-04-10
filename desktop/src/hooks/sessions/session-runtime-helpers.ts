import type { SessionStreamHandle } from "@anyharness/sdk";
import { resolveSessionViewState } from "@/lib/domain/sessions/activity";
import { isPendingSessionId } from "@/lib/integrations/anyharness/session-runtime";
import { useHarnessStore } from "@/stores/sessions/harness-store";

export function shouldReconnectStream(sessionId: string): boolean {
  const slot = useHarnessStore.getState().sessionSlots[sessionId];
  if (!slot || isPendingSessionId(sessionId)) {
    return false;
  }

  const viewState = resolveSessionViewState(slot);
  return viewState === "working" || viewState === "needs_input";
}

export function isCurrentStreamHandle(
  sessionId: string,
  handle: SessionStreamHandle,
): boolean {
  return useHarnessStore.getState().sessionSlots[sessionId]?.sseHandle === handle;
}
