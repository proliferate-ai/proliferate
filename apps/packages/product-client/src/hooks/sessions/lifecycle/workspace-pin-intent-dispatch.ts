import type { SessionEventEnvelope } from "@anyharness/sdk";

export type WorkspacePinIntentReconciler = (
  envelopes: readonly SessionEventEnvelope[],
) => void;

const MAX_BUFFERED_WORKSPACE_PIN_INTENTS = 128;

let activeReconciler: WorkspacePinIntentReconciler | null = null;
let bufferedEnvelopes: SessionEventEnvelope[] = [];

export function dispatchWorkspacePinIntentEnvelopes(
  envelopes: readonly SessionEventEnvelope[],
): void {
  const pinEnvelopes = envelopes.filter(
    (envelope) => envelope.event.type === "workspace_pin_intent",
  );
  if (pinEnvelopes.length === 0) {
    return;
  }
  if (activeReconciler) {
    activeReconciler(pinEnvelopes);
    return;
  }
  bufferedEnvelopes = [...bufferedEnvelopes, ...pinEnvelopes].slice(
    -MAX_BUFFERED_WORKSPACE_PIN_INTENTS,
  );
}

export function registerWorkspacePinIntentReconciler(
  reconciler: WorkspacePinIntentReconciler,
): () => void {
  activeReconciler = reconciler;
  if (bufferedEnvelopes.length > 0) {
    const pending = bufferedEnvelopes;
    bufferedEnvelopes = [];
    reconciler(pending);
  }
  return () => {
    if (activeReconciler === reconciler) {
      activeReconciler = null;
    }
  };
}

export function resetWorkspacePinIntentDispatchForTests(): void {
  activeReconciler = null;
  bufferedEnvelopes = [];
}
