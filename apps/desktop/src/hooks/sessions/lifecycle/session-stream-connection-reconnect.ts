import {
  clearSessionReconnectTimer,
  nextSessionReconnectDelayMs,
  registerOfflineSessionReconnect,
  scheduleSessionReconnectTimer,
} from "@/lib/workflows/sessions/session-reconnect-state";
import { isConnectivityOnline } from "@/stores/infra/connectivity-store";
import { shouldReconnectStream } from "@/hooks/sessions/lifecycle/session-runtime-helpers";
import type {
  RefreshSessionSlotMeta,
  SessionStreamConnectOptions,
} from "@/hooks/sessions/lifecycle/session-stream-connection-types";

interface ScheduleSessionStreamReconnectInput {
  sessionId: string;
  delayMs?: number;
  options: SessionStreamConnectOptions | undefined;
  refreshSessionSlotMeta: RefreshSessionSlotMeta;
  ensureSessionStreamConnected: (
    sessionId: string,
    options?: SessionStreamConnectOptions,
  ) => Promise<void>;
  isStillCurrent: () => boolean;
}

export function scheduleSessionStreamReconnect({
  sessionId,
  delayMs = 350,
  options,
  refreshSessionSlotMeta,
  ensureSessionStreamConnected,
  isStillCurrent,
}: ScheduleSessionStreamReconnectInput): void {
  clearSessionReconnectTimer(sessionId);
  if (!isStillCurrent() || !shouldReconnectStream(sessionId)) {
    return;
  }
  if (options?.reconnectOwner === "external") {
    options.onReconnectNeeded?.();
    return;
  }

  const runner = () => {
    if (!isStillCurrent() || !shouldReconnectStream(sessionId)) {
      return;
    }

    void refreshSessionSlotMeta(sessionId, {
      resumeIfActive: true,
      isCurrent: options?.isCurrent,
    })
      .finally(() => {
        if (isStillCurrent()) {
          void ensureSessionStreamConnected(sessionId, {
            isCurrent: options?.isCurrent,
          });
        }
      });
  };

  // If offline, park the runner instead of spinning a timer — it will fire
  // once the online transition triggers flushOfflineSessionReconnects.
  if (!isConnectivityOnline()) {
    registerOfflineSessionReconnect(sessionId, runner);
    return;
  }

  const backoffDelay = nextSessionReconnectDelayMs(sessionId, delayMs);
  scheduleSessionReconnectTimer(sessionId, runner, backoffDelay);
}
