import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
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
  const host = useProductHost();
  const ssh = host.desktop?.ssh ?? null;
  const cloudClient = host.cloud.client;
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
      ssh,
      cloudClient,
      options,
      createSessionStreamFlushController,
      refreshSessionSlotMeta,
      ensureSessionStreamConnected,
    });
  }, [
    closeSessionSlotStream,
    cloudClient,
    createSessionStreamFlushController,
    refreshSessionSlotMeta,
    rehydrateSessionSlotFromHistory,
    ssh,
  ]);

  return {
    closeSessionSlotStream,
    ensureSessionStreamConnected,
  };
}
