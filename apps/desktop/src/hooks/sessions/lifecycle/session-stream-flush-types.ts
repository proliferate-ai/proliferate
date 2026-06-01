import type { StreamBatchScheduler } from "@proliferate/product-domain/chats/transcript/stream-batcher";
import type { PendingSessionConfigChange } from "@proliferate/product-domain/sessions/pending-config";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import type { ReconciledStreamConfigIntent } from "@/lib/domain/sessions/stream/stream-side-effect-plan";
import type { SessionStreamCache } from "@/hooks/sessions/cache/use-session-stream-cache";

export interface SessionStreamFlushController {
  enqueue(envelope: import("@anyharness/sdk").SessionEventEnvelope): void;
  flushNow(): void;
  dispose(): void;
}

export interface SessionStreamFlushFactoryDeps {
  sessionStreamCache: SessionStreamCache;
  mountSubagentChildSession: (input: {
    childSessionId: string;
    label: string | null;
    workspaceId: string | null;
    parentSessionId: string | null;
    sessionLinkId?: string | null;
    requestHeaders?: HeadersInit;
  }) => Promise<void> | void;
  persistReconciledModePreferences: (
    workspaceId: string | null | undefined,
    agentKind: string | null | undefined,
    liveConfigRawConfigId: string | null | undefined,
    reconciledChanges: PendingSessionConfigChange[],
    liveConfigValueResolver: (rawConfigId: string) => string | null,
  ) => void;
  refreshSessionSlotMeta: (
    sessionId: string,
    options?: {
      resumeIfActive?: boolean;
      requestHeaders?: HeadersInit;
      measurementOperationId?: MeasurementOperationId | null;
      isCurrent?: () => boolean;
    },
  ) => Promise<void>;
  rehydrateSessionSlotFromHistory: (
    sessionId: string,
    options?: {
      afterSeq?: number;
      requestHeaders?: HeadersInit;
      measurementOperationId?: MeasurementOperationId | null;
      timeoutMs?: number;
      isCurrent?: () => boolean;
    },
  ) => Promise<boolean>;
  showToast: (message: string, type?: "error" | "info") => void;
  scheduler?: SessionStreamFlushScheduler;
}

export interface SessionStreamFlushControllerOptions {
  sessionId: string;
  streamMeasurementOperationId: MeasurementOperationId | null;
  requestHeaders?: HeadersInit;
  isStillCurrent: () => boolean;
  isCurrentStream: () => boolean;
  closeCurrentHandle: () => void;
  scheduleReconnect: (delayMs?: number) => void;
  clearActiveSummaryRefreshTimer: () => void;
  scheduleActiveSummaryRefresh: () => void;
  scheduleStartupReadyRefresh: (
    reason: "stream_open" | "available_commands",
    delayMs: number,
  ) => void;
}

export interface BatchConfigReconcileResult {
  pendingConfigChanges: import("@proliferate/product-domain/sessions/pending-config").PendingSessionConfigChanges;
  reconciledIntents: ReconciledStreamConfigIntent[];
}

export type SessionStreamFlushScheduler = StreamBatchScheduler;
