import type { SessionLiveConfigSnapshot } from "@anyharness/sdk";
import type { StreamBatchScheduler } from "#product/domain/chats/transcript/stream-batcher";
import type { PendingSessionConfigChange } from "#product/domain/sessions/pending-config";
import type { MeasurementOperationId } from "#product/lib/domain/telemetry/debug-measurement-catalog";
import type { ReconciledStreamConfigIntent } from "#product/lib/domain/sessions/stream/stream-side-effect-plan";
import type { SessionStreamCache } from "#product/hooks/sessions/cache/use-session-stream-cache";
import type { WorkspacePinIntentReconciler } from "#product/hooks/sessions/lifecycle/workspace-pin-intent-dispatch";

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
  persistReconciledControlPreferences: (
    workspaceId: string | null | undefined,
    agentKind: string | null | undefined,
    liveConfig: SessionLiveConfigSnapshot,
    reconciledChanges: PendingSessionConfigChange[],
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
  reconcileWorkspacePinIntents: WorkspacePinIntentReconciler;
  scheduler?: SessionStreamFlushScheduler;
}

export interface SessionStreamFlushControllerOptions {
  sessionId: string;
  streamMeasurementOperationId: MeasurementOperationId | null;
  requestHeaders?: HeadersInit;
  isStillCurrent: () => boolean;
  isCurrentStream: () => boolean;
  closeCurrentHandle: () => void;
  /**
   * Schedule a normal error-retry reconnect on the shared backoff curve (Q9).
   * Advances the per-session attempt counter.
   */
  scheduleReconnect: () => void;
  /**
   * Schedule a bypass-backoff reconnect for a gap-reconcile forced close. This
   * is NOT an error retry: it fires immediately and must NOT advance the shared
   * backoff attempt counter (which would inflate later genuine retries).
   */
  scheduleImmediateReconnect: () => void;
  clearActiveSummaryRefreshTimer: () => void;
  scheduleActiveSummaryRefresh: () => void;
  scheduleStartupReadyRefresh: (
    reason: "stream_open" | "available_commands",
    delayMs: number,
  ) => void;
}

export interface BatchConfigReconcileResult {
  pendingConfigChanges: import("#product/domain/sessions/pending-config").PendingSessionConfigChanges;
  reconciledIntents: ReconciledStreamConfigIntent[];
}

export type SessionStreamFlushScheduler = StreamBatchScheduler;
