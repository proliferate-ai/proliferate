import { create } from "zustand";
import type { ModelLaunchRemediation } from "@anyharness/sdk";

export type SessionModelAvailabilityDecisionKind =
  | "managed_reinstall"
  | "external_update"
  | "restart"
  | "use_current"
  | "cancel";

export interface SessionModelAvailabilityDecision {
  kind: SessionModelAvailabilityDecisionKind;
}

export interface PausedSessionModelAvailability {
  id: string;
  sessionId: string;
  workspaceId: string;
  agentKind: string;
  providerDisplayName: string;
  requestedModelId: string;
  requestedModelDisplayName: string;
  currentModelId: string;
  currentModelDisplayName: string;
  remediation: ModelLaunchRemediation | null;
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
