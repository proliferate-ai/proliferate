import { patchSessionRecord } from "@/stores/sessions/session-records";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";

export function markProjectedSessionPromptCreateFailed(
  clientSessionId: string,
  error: unknown,
): void {
  patchSessionRecord(clientSessionId, {
    status: "errored",
  });
  const message = error instanceof Error && error.message.trim()
    ? error.message
    : "Session creation failed.";
  const store = useSessionIntentStore.getState();
  for (const intent of Object.values(store.entriesById)) {
    if (intent.kind !== "send_prompt") {
      continue;
    }
    const entry = intent;
    if (
      entry.clientSessionId !== clientSessionId
      || entry.deliveryState === "cancelled"
      || entry.deliveryState === "echoed_tombstone"
    ) {
      continue;
    }
    store.patchIntent(entry.intentId, {
      deliveryState: "failed_before_dispatch",
      errorMessage: message,
    });
  }
}
