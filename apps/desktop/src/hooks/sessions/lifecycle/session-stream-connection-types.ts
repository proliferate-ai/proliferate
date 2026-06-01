import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import type { useSessionStreamFlushControllerFactory } from "@/hooks/sessions/lifecycle/use-session-stream-flush";

export interface SessionStreamConnectOptions {
  awaitOpen?: boolean;
  openTimeoutMs?: number;
  resumeIfActive?: boolean;
  allowColdIdleNoStream?: boolean;
  hydrateBeforeStream?: boolean;
  skipInitialRefresh?: boolean;
  refreshOnStartupReady?: boolean;
  forceReconnect?: boolean;
  reconnectOwner?: "internal" | "external";
  onReconnectNeeded?: () => void;
  requestHeaders?: HeadersInit;
  measurementOperationId?: MeasurementOperationId | null;
  isCurrent?: () => boolean;
}

export type RefreshSessionSlotMeta = (
  sessionId: string,
  options?: {
    resumeIfActive?: boolean;
    requestHeaders?: HeadersInit;
    measurementOperationId?: MeasurementOperationId | null;
    isCurrent?: () => boolean;
  },
) => Promise<void>;

export type RehydrateSessionSlotFromHistory = (
  sessionId: string,
  options?: {
    requestHeaders?: HeadersInit;
    measurementOperationId?: MeasurementOperationId | null;
    isCurrent?: () => boolean;
  },
) => Promise<boolean>;

export interface UseSessionStreamConnectionActionsOptions {
  createSessionStreamFlushController: ReturnType<typeof useSessionStreamFlushControllerFactory>;
  refreshSessionSlotMeta: RefreshSessionSlotMeta;
  rehydrateSessionSlotFromHistory: RehydrateSessionSlotFromHistory;
}
