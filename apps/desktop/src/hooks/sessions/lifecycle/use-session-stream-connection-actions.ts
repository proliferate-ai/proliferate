import { useCallback } from "react";
import { openSessionStreamConnection } from "@/hooks/sessions/lifecycle/session-stream-connection-open";
import { prepareSessionStreamConnection } from "@/hooks/sessions/lifecycle/session-stream-connection-prepare";
import { closeSessionSlotStream as closeSessionSlotStreamForSession } from "@/hooks/sessions/lifecycle/session-stream-slot-connection";
import type {
  SessionStreamConnectOptions,
  UseSessionStreamConnectionActionsOptions,
} from "@/hooks/sessions/lifecycle/session-stream-connection-types";

export function useSessionStreamConnectionActions({
  createSessionStreamFlushController,
  refreshSessionSlotMeta,
  rehydrateSessionSlotFromHistory,
}: UseSessionStreamConnectionActionsOptions) {
  const closeSessionSlotStream = useCallback((sessionId: string) => {
    closeSessionSlotStreamForSession(sessionId);
  }, []);

  const ensureSessionStreamConnected = useCallback(async (
    sessionId: string,
    options?: SessionStreamConnectOptions,
  ): Promise<void> => {
    const shouldOpenStream = await prepareSessionStreamConnection(sessionId, options, {
      refreshSessionSlotMeta,
      rehydrateSessionSlotFromHistory,
    });
    if (!shouldOpenStream) {
      return;
    }

    closeSessionSlotStream(sessionId);
    if (options?.isCurrent && !options.isCurrent()) {
      return;
    }

    await openSessionStreamConnection({
      sessionId,
      options,
      createSessionStreamFlushController,
      refreshSessionSlotMeta,
      ensureSessionStreamConnected,
    });
  }, [
    closeSessionSlotStream,
    createSessionStreamFlushController,
    refreshSessionSlotMeta,
    rehydrateSessionSlotFromHistory,
  ]);

  return {
    closeSessionSlotStream,
    ensureSessionStreamConnected,
  };
}
