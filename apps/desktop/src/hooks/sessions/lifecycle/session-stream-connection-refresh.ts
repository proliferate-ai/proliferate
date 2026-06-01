import { resolveSessionViewState } from "@proliferate/product-domain/sessions/activity";
import { activitySnapshotFromDirectoryEntry } from "@/lib/domain/sessions/directory/directory-activity";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import type {
  RefreshSessionSlotMeta,
  SessionStreamConnectOptions,
} from "@/hooks/sessions/lifecycle/session-stream-connection-types";

const ACTIVE_SUMMARY_REFRESH_DELAY_MS = 8_000;

interface SessionStreamRefreshControllerInput {
  sessionId: string;
  options: SessionStreamConnectOptions | undefined;
  streamMeasurementOperationId: MeasurementOperationId | null;
  refreshSessionSlotMeta: RefreshSessionSlotMeta;
  isStillCurrent: () => boolean;
  isCurrentStream: () => boolean;
}

export interface SessionStreamRefreshController {
  scheduleStartupReadyRefresh(
    reason: "stream_open" | "available_commands",
    delayMs: number,
  ): void;
  clearStartupReadyRefreshTimer(): void;
  clearActiveSummaryRefreshTimer(): void;
  scheduleActiveSummaryRefresh(): void;
}

export function createSessionStreamRefreshController({
  sessionId,
  options,
  streamMeasurementOperationId,
  refreshSessionSlotMeta,
  isStillCurrent,
  isCurrentStream,
}: SessionStreamRefreshControllerInput): SessionStreamRefreshController {
  let startupReadyRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSummaryRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let startupReadyRefreshStarted = false;

  const scheduleStartupReadyRefresh = (
    reason: "stream_open" | "available_commands",
    delayMs: number,
  ) => {
    if (!options?.refreshOnStartupReady || startupReadyRefreshStarted) {
      return;
    }
    if (startupReadyRefreshTimer) {
      clearTimeout(startupReadyRefreshTimer);
    }
    startupReadyRefreshTimer = setTimeout(() => {
      startupReadyRefreshTimer = null;
      if (startupReadyRefreshStarted) {
        return;
      }
      startupReadyRefreshStarted = true;
      const refreshStartedAt = performance.now();
      void refreshSessionSlotMeta(sessionId, {
        resumeIfActive: false,
        requestHeaders: options?.requestHeaders,
        measurementOperationId: streamMeasurementOperationId,
        isCurrent: options?.isCurrent,
      }).then(() => {
        logLatency("session.stream.startup_meta_refreshed", {
          sessionId,
          reason,
          elapsedMs: Math.round(performance.now() - refreshStartedAt),
        });
      }).catch(() => {
        logLatency("session.stream.startup_meta_refresh_failed", {
          sessionId,
          reason,
          elapsedMs: Math.round(performance.now() - refreshStartedAt),
        });
      });
    }, delayMs);
  };

  const clearStartupReadyRefreshTimer = () => {
    if (!startupReadyRefreshTimer) {
      return;
    }
    clearTimeout(startupReadyRefreshTimer);
    startupReadyRefreshTimer = null;
  };

  const clearActiveSummaryRefreshTimer = () => {
    if (!activeSummaryRefreshTimer) {
      return;
    }
    clearTimeout(activeSummaryRefreshTimer);
    activeSummaryRefreshTimer = null;
  };

  const shouldRefreshActiveSummary = () => {
    if (!isStillCurrent()) {
      return false;
    }
    const latestEntry = useSessionDirectoryStore.getState().entriesById[sessionId] ?? null;
    return resolveSessionViewState(activitySnapshotFromDirectoryEntry(latestEntry)) === "working";
  };

  const scheduleActiveSummaryRefresh = () => {
    clearActiveSummaryRefreshTimer();
    if (!shouldRefreshActiveSummary()) {
      return;
    }

    activeSummaryRefreshTimer = setTimeout(() => {
      activeSummaryRefreshTimer = null;
      if (!isCurrentStream() || !shouldRefreshActiveSummary()) {
        return;
      }

      const refreshStartedAt = performance.now();
      void refreshSessionSlotMeta(sessionId, {
        resumeIfActive: false,
        requestHeaders: options?.requestHeaders,
        measurementOperationId: streamMeasurementOperationId,
        isCurrent: options?.isCurrent,
      }).then(() => {
        logLatency("session.stream.active_meta_refreshed", {
          sessionId,
          elapsedMs: Math.round(performance.now() - refreshStartedAt),
        });
      }).catch(() => {
        logLatency("session.stream.active_meta_refresh_failed", {
          sessionId,
          elapsedMs: Math.round(performance.now() - refreshStartedAt),
        });
      }).finally(() => {
        if (isCurrentStream() && shouldRefreshActiveSummary()) {
          scheduleActiveSummaryRefresh();
        }
      });
    }, ACTIVE_SUMMARY_REFRESH_DELAY_MS);
  };

  return {
    scheduleStartupReadyRefresh,
    clearStartupReadyRefreshTimer,
    clearActiveSummaryRefreshTimer,
    scheduleActiveSummaryRefresh,
  };
}
