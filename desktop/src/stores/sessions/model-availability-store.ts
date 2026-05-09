import { create } from "zustand";
import type { PausedSessionModelAvailability } from "@/lib/domain/sessions/creation/model-availability";

export type SessionModelAvailabilityDecisionKind =
  | "managed_reinstall"
  | "external_update"
  | "restart"
  | "use_current"
  | "cancel";

export interface SessionModelAvailabilityDecision {
  kind: SessionModelAvailabilityDecisionKind;
}

type DecisionResolver = (decision: SessionModelAvailabilityDecision) => void;

interface SessionModelAvailabilityStore {
  pausedLaunch: PausedSessionModelAvailability | null;
  resolveDecision: DecisionResolver | null;
  setPendingDecision: (
    pausedLaunch: PausedSessionModelAvailability,
    resolveDecision: DecisionResolver,
  ) => void;
  clearPendingDecision: () => void;
}

export const useSessionModelAvailabilityStore =
  create<SessionModelAvailabilityStore>((set) => ({
    pausedLaunch: null,
    resolveDecision: null,
    setPendingDecision: (pausedLaunch, resolveDecision) => set({
      pausedLaunch,
      resolveDecision,
    }),
    clearPendingDecision: () => set({
      pausedLaunch: null,
      resolveDecision: null,
    }),
  }));

export function resetSessionModelAvailabilityStore(): void {
  useSessionModelAvailabilityStore.setState({
    pausedLaunch: null,
    resolveDecision: null,
  });
}
