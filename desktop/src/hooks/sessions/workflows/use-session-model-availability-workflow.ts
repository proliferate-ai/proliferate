import { useCallback } from "react";
import {
  type PausedSessionModelAvailability,
  type SessionModelAvailabilityDecision,
  useSessionModelAvailabilityStore,
} from "@/stores/sessions/model-availability-store";

export type {
  PausedSessionModelAvailability,
  SessionModelAvailabilityDecision,
  SessionModelAvailabilityDecisionKind,
} from "@/stores/sessions/model-availability-store";

export class SessionModelAvailabilityCancelledError extends Error {
  constructor() {
    super("Session launch cancelled.");
    this.name = "SessionModelAvailabilityCancelledError";
  }
}

export class SessionModelAvailabilityRoutedToSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionModelAvailabilityRoutedToSettingsError";
  }
}

export class SessionModelAvailabilityBusyError extends Error {
  constructor() {
    super("Another model availability decision is already pending.");
    this.name = "SessionModelAvailabilityBusyError";
  }
}

function resolveCurrent(decision: SessionModelAvailabilityDecision): void {
  const resolve = useSessionModelAvailabilityStore.getState().resolveDecision;
  useSessionModelAvailabilityStore.getState().clearPendingDecision();
  resolve?.(decision);
}

export function requestSessionModelAvailabilityDecision(
  input: PausedSessionModelAvailability,
): Promise<SessionModelAvailabilityDecision> {
  const state = useSessionModelAvailabilityStore.getState();
  if (state.pausedLaunch || state.resolveDecision) {
    return Promise.reject(new SessionModelAvailabilityBusyError());
  }

  return new Promise((resolve) => {
    useSessionModelAvailabilityStore.getState().setPendingDecision(input, resolve);
  });
}

export function isSessionModelAvailabilityCancelled(
  error: unknown,
): error is SessionModelAvailabilityCancelledError {
  return error instanceof SessionModelAvailabilityCancelledError;
}

export function isSessionModelAvailabilityRoutedToSettings(
  error: unknown,
): error is SessionModelAvailabilityRoutedToSettingsError {
  return error instanceof SessionModelAvailabilityRoutedToSettingsError;
}

export function isSessionModelAvailabilityInterruption(error: unknown): boolean {
  return isSessionModelAvailabilityCancelled(error)
    || isSessionModelAvailabilityRoutedToSettings(error);
}

export function useSessionModelAvailabilityWorkflow() {
  const pausedLaunch = useSessionModelAvailabilityStore((state) => state.pausedLaunch);

  const cancel = useCallback(() => {
    resolveCurrent({ kind: "cancel" });
  }, []);

  const useCurrentModel = useCallback(() => {
    resolveCurrent({ kind: "use_current" });
  }, []);

  const runPrimaryAction = useCallback(() => {
    const remediationKind = useSessionModelAvailabilityStore
      .getState()
      .pausedLaunch
      ?.remediation
      ?.kind;
    if (!remediationKind) {
      return;
    }
    resolveCurrent({ kind: remediationKind });
  }, []);

  return {
    pausedLaunch,
    cancel,
    runPrimaryAction,
    useCurrentModel,
  };
}
