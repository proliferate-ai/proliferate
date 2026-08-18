import type { SessionEventEnvelope } from "@anyharness/sdk";
import type { WorkspacePinLocalOrder } from "#product/lib/domain/preferences/workspace-ui/model";
import type { WorkspacePinIntentProvenance } from "#product/lib/domain/workspaces/sidebar/workspace-pin-intents";
import { nextWorkspacePinLocalOrder } from "#product/stores/preferences/workspace-ui-pin-local-order";

export interface WorkspacePinIntentEnvelopeObservation {
  envelope: SessionEventEnvelope;
  observedAt: WorkspacePinLocalOrder;
  provenance: WorkspacePinIntentProvenance;
}

export type WorkspacePinIntentReconciler = (
  observations: readonly WorkspacePinIntentEnvelopeObservation[],
) => void;

export type WorkspacePinIntentEnvelopeDispatcher = (
  envelopes: readonly SessionEventEnvelope[],
) => void;

const MAX_BUFFERED_WORKSPACE_PIN_INTENTS = 128;

let activeReconciler: WorkspacePinIntentReconciler | null = null;
let bufferedObservations: WorkspacePinIntentEnvelopeObservation[] = [];

export function dispatchWorkspacePinIntentEnvelopes(
  envelopes: readonly SessionEventEnvelope[],
  provenance: WorkspacePinIntentProvenance,
): void {
  const observations = envelopes.flatMap((envelope) => (
    envelope.event.type === "workspace_pin_intent"
      ? [{ envelope, observedAt: nextWorkspacePinLocalOrder(), provenance }]
      : []
  ));
  if (observations.length === 0) {
    return;
  }
  if (activeReconciler) {
    activeReconciler(observations);
    return;
  }
  bufferedObservations = [...bufferedObservations, ...observations].slice(
    -MAX_BUFFERED_WORKSPACE_PIN_INTENTS,
  );
}

export const dispatchLiveWorkspacePinIntentEnvelopes: WorkspacePinIntentEnvelopeDispatcher = (
  envelopes,
) => {
  dispatchWorkspacePinIntentEnvelopes(envelopes, "live");
};

export function registerWorkspacePinIntentReconciler(
  reconciler: WorkspacePinIntentReconciler,
): () => void {
  activeReconciler = reconciler;
  if (bufferedObservations.length > 0) {
    const pending = bufferedObservations;
    bufferedObservations = [];
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
  bufferedObservations = [];
}
