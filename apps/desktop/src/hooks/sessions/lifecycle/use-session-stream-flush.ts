import { useCallback } from "react";
import {
  animationFrameSessionStreamFlushScheduler,
  createSessionStreamFlushController,
} from "#product/hooks/sessions/lifecycle/session-stream-flush-controller";
import type {
  SessionStreamFlushController,
  SessionStreamFlushControllerOptions,
  SessionStreamFlushFactoryDeps,
  SessionStreamFlushScheduler,
} from "#product/hooks/sessions/lifecycle/session-stream-flush-types";

export function useSessionStreamFlushControllerFactory({
  sessionStreamCache,
  mountSubagentChildSession,
  persistReconciledModePreferences,
  refreshSessionSlotMeta,
  rehydrateSessionSlotFromHistory,
  showToast,
  scheduler = animationFrameSessionStreamFlushScheduler,
}: SessionStreamFlushFactoryDeps) {
  return useCallback((options: SessionStreamFlushControllerOptions) =>
    createSessionStreamFlushController({
      ...options,
      sessionStreamCache,
      mountSubagentChildSession,
      persistReconciledModePreferences,
      refreshSessionSlotMeta,
      rehydrateSessionSlotFromHistory,
      showToast,
      scheduler,
    }), [
    mountSubagentChildSession,
    persistReconciledModePreferences,
    refreshSessionSlotMeta,
    rehydrateSessionSlotFromHistory,
    scheduler,
    sessionStreamCache,
    showToast,
  ]);
}

export {
  animationFrameSessionStreamFlushScheduler,
  createSessionStreamFlushController,
};

export type {
  SessionStreamFlushController,
  SessionStreamFlushScheduler,
};
