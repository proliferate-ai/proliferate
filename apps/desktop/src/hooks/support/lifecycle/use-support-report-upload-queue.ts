import {
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext,
  type AnyHarnessResolvedConnection,
} from "@anyharness/sdk-react";
import { useEffect, useMemo, useRef } from "react";
import type { DesktopDiagnosticsBridge } from "@proliferate/product-client/host/desktop-diagnostics-bridge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";

import { useProductStorageContext } from "@/hooks/app/facade/use-product-storage-context";
import {
  useProductTelemetry,
  type ProductTelemetryFacade,
} from "@/hooks/telemetry/facade/use-product-telemetry";
import { createSessionDebugClient } from "@/lib/access/anyharness/debug-client";
import { listenSupportReportJobs } from "@/lib/access/browser/support-report-job-events";
import {
  describeSupportReportUploadFailure,
  shouldShowSupportReportUploadFailureToast,
  supportReportRetriesExhausted,
} from "@/lib/domain/support/report-upload-failure";
import type { ProductStorageContext } from "@/lib/infra/persistence/product-storage";
import type { SupportReportUploadDependencies } from "@/lib/workflows/support/support-report-upload-workflows";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  deleteSupportReportJobAttachments,
  markPersistedJobFailed,
  persistSupportReportJob,
  readPersistedJobs,
  removePersistedJob,
  scheduleNextRetry,
} from "./support-report-upload-persistence";
import {
  uploadSupportReport,
  type SupportReportUploadResult,
} from "./support-report-upload-execution";

export function useSupportReportUploadQueue(): void {
  const host = useProductHost();
  const persistence = useProductStorageContext();
  const diagnostics = host.desktop?.diagnostics ?? null;
  const cloudClient = host.cloud.client;
  const telemetry = useProductTelemetry();
  const workspaceContext = useAnyHarnessWorkspaceContext();
  const contextWorkspaceId = workspaceContext.workspaceId;
  const resolveConnection = workspaceContext.resolveConnection;
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const showToast = useToastStore((state) => state.show);
  const processingRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);

  const dependencies = useMemo<
    SupportReportUploadDependencies<AnyHarnessResolvedConnection>
  >(() => ({
    now: () => new Date(),
    collectDiagnostics: () => diagnostics?.collectSupportBundle() ?? Promise.resolve(null),
    resolveWorkspace: (workspaceId) => resolveWorkspaceConnectionFromContext(
      {
        workspaceId: contextWorkspaceId,
        resolveConnection,
      },
      workspaceId,
    ),
    getClient: createSessionDebugClient,
  }), [contextWorkspaceId, diagnostics, resolveConnection, runtimeUrl]);

  useEffect(() => {
    let disposed = false;
    let unlistenJobs: (() => void) | null = null;

    const processQueue = () => {
      if (disposed || processingRef.current || !cloudClient) {
        return;
      }
      processingRef.current = true;
      void drainSupportReportQueue(
        dependencies,
        diagnostics,
        cloudClient,
        showToast,
        telemetry,
        persistence,
      ).finally(async () => {
        processingRef.current = false;
        if (!disposed) {
          await scheduleNextRetry(persistence, processQueue, retryTimerRef);
        }
      });
    };

    void listenSupportReportJobs((job) => {
      if (disposed) {
        return;
      }
      void persistSupportReportJob(persistence, job).then((queued) => {
        if (disposed || !queued) {
          return;
        }
        showToast("Sending report...", "info");
        processQueue();
      });
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenJobs = unlisten;
      processQueue();
    });

    return () => {
      disposed = true;
      unlistenJobs?.();
      if (retryTimerRef.current != null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [cloudClient, dependencies, diagnostics, persistence, showToast, telemetry]);
}

async function drainSupportReportQueue(
  dependencies: SupportReportUploadDependencies<AnyHarnessResolvedConnection>,
  diagnostics: DesktopDiagnosticsBridge | null,
  cloudClient: ProliferateCloudClient,
  showToast: (message: string, type?: "error" | "info") => void,
  telemetry: ProductTelemetryFacade,
  persistence: ProductStorageContext,
): Promise<void> {
  const queued = await readPersistedJobs(persistence);
  const now = Date.now();
  for (const entry of queued) {
    const nextAttemptMs = entry.nextAttemptAt ? Date.parse(entry.nextAttemptAt) : 0;
    if (Number.isFinite(nextAttemptMs) && nextAttemptMs > now) {
      continue;
    }

    let result: SupportReportUploadResult;
    try {
      result = await uploadSupportReport(
        entry.job,
        dependencies,
        diagnostics,
        cloudClient,
        telemetry,
      );
    } catch (error) {
      const attemptCount = entry.attemptCount + 1;
      const failure = describeSupportReportUploadFailure(error, attemptCount);
      await logQueueEvent(diagnostics, `failed.${failure.kind}`);

      if (failure.kind === "already_completed") {
        await removePersistedJob(persistence, entry.job.jobId);
        await deleteSupportReportJobAttachments(
          entry.job,
          diagnostics?.deleteAttachment,
        );
        showToast(failure.toastMessage, "info");
        continue;
      }

      const exhausted = supportReportRetriesExhausted({
        kind: failure.kind,
        attemptCount,
        createdAt: entry.job.createdAt,
        nowMs: Date.now(),
      });
      if (!failure.retryable || exhausted) {
        await removePersistedJob(persistence, entry.job.jobId);
        await deleteSupportReportJobAttachments(
          entry.job,
          diagnostics?.deleteAttachment,
        );
        if (exhausted) {
          await logQueueEvent(diagnostics, "dropped.exhausted");
          showToast(
            "Couldn't send your report after several tries. Please try again from Help.",
          );
        } else {
          showToast(failure.toastMessage);
        }
        continue;
      }

      const nowMs = Date.now();
      const shouldToast = shouldShowSupportReportUploadFailureToast({
        failure,
        lastToastAt: entry.lastFailureToastAt,
        lastToastKind: entry.lastFailureToastKind,
        nowMs,
      });
      await markPersistedJobFailed(
        persistence,
        entry.job.jobId,
        failure,
        new Date(nowMs),
        shouldToast,
      );
      if (shouldToast) {
        showToast(failure.toastMessage);
      }
      continue;
    }

    await removePersistedJob(persistence, entry.job.jobId);
    showToast(
      `Thanks. Report sent. Support has the details. (${result.reportId})`,
      "info",
    );
  }
}

async function logQueueEvent(
  diagnostics: DesktopDiagnosticsBridge | null,
  message: string,
): Promise<void> {
  if (!diagnostics) return;
  try {
    await diagnostics.logEvent({
      source: "support_report_upload",
      message,
    });
  } catch {
    // Diagnostics logging must not block queue progress.
  }
}
