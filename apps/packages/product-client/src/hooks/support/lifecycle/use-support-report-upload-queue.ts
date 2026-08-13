import { useEffect, useRef } from "react";
import type { DesktopDiagnosticsBridge } from "@proliferate/product-client/host/desktop-bridge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useProductTelemetry } from "#product/hooks/telemetry/facade/use-product-telemetry";
import { listenSupportReportJobs } from "#product/lib/access/browser/support-report-job-events";
import {
  describeSupportReportUploadFailure,
  shouldShowSupportReportUploadFailureToast,
  supportReportRetriesExhausted,
} from "#product/lib/domain/support/report-upload-failure";
import {
  diagnosticField,
  recordRendererDiagnostic,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import { useToastStore } from "#product/stores/toast/toast-store";

import { createCapabilityAwareSupportReportQueue } from "./support-report-queue-factory";
import type {
  SupportReportQueueCallbacks,
  SupportReportQueueRuntime,
} from "./support-report-queue-runtime";
import {
  legacyConsentRequired,
  uploadSupportReportAttempt,
  type SupportReportUploadTelemetry,
} from "./support-report-upload-attempt";

/** Mount the single upload owner after capability-aware queue hydration. */
export function useSupportReportUploadQueue(): void {
  const host = useProductHost();
  const diagnostics = host.desktop?.diagnostics ?? null;
  const supportSnapshot = diagnostics?.supportSnapshot ?? null;
  const productTelemetry = useProductTelemetry();
  const telemetry = productTelemetry as SupportReportUploadTelemetry;
  const showToast = useToastStore((state) => state.show);
  const retryTimerRef = useRef<number | null>(null);
  const ownerTailRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let disposed = false;
    let draining = false;
    let unlisten: (() => void) | null = null;
    let initialization: Promise<void> | null = null;
    let activeDrain: Promise<void> | null = null;
    const activeEnqueues = new Set<Promise<unknown>>();
    let releaseScheduled = false;
    let released = false;
    let releaseOwner!: () => void;
    const ownerDone = new Promise<void>((resolve) => {
      releaseOwner = resolve;
    });
    const acquireOwner = ownerTailRef.current;
    ownerTailRef.current = acquireOwner.then(() => ownerDone);
    const callbacks = queueCallbacks(showToast, productTelemetry.captureException);
    const queue: SupportReportQueueRuntime = createCapabilityAwareSupportReportQueue({
      storage: host.storage,
      diagnostics,
      supportSnapshot,
      callbacks,
    });

    const releaseWhenIdle = () => {
      if (!disposed || released || releaseScheduled) return;
      const pending: Promise<unknown>[] = [...activeEnqueues];
      if (initialization) pending.push(initialization);
      if (activeDrain) pending.push(activeDrain);
      if (pending.length === 0) {
        released = true;
        releaseOwner();
        return;
      }
      releaseScheduled = true;
      void Promise.allSettled(pending).then(() => {
        releaseScheduled = false;
        releaseWhenIdle();
      });
    };

    const schedule = async () => {
      if (disposed) return;
      if (retryTimerRef.current != null) window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
      let next: number | null;
      try {
        next = await queue.nextAttemptAtMs();
      } catch (error) {
        callbacks.onControllerError(error);
        if (!disposed) {
          showToast("Saved support reports couldn't be updated. Uploads are paused.");
        }
        return;
      }
      if (disposed || next == null) return;
      retryTimerRef.current = window.setTimeout(runDrain, Math.max(1_000, next - Date.now()));
    };

    const runDrain = () => {
      if (disposed || draining) return;
      draining = true;
      const operation = drainSupportReportQueue({
        queue,
        diagnostics,
        supportSnapshot,
        showToast,
        telemetry,
        isActive: () => !disposed,
        onLifecycleError(error) {
          productTelemetry.captureException(error, {
            tags: { domain: "support_queue", action: "native_lifecycle" },
          });
        },
      });
      activeDrain = operation;
      void operation.catch((error) => {
        callbacks.onControllerError(error);
        if (!disposed) {
          showToast("Saved support reports couldn't be updated. Uploads are paused.");
        }
      }).finally(() => {
        if (activeDrain === operation) activeDrain = null;
        draining = false;
        void schedule();
        releaseWhenIdle();
      });
    };

    const initializeOwner = acquireOwner.then(async () => {
      if (disposed) return;
      await queue.initialize();
      if (disposed) return;
      unlisten = await listenSupportReportJobs(async (job) => {
        if (disposed) return "failed";
        const enqueue = queue.enqueue(job);
        activeEnqueues.add(enqueue);
        const result = await enqueue.finally(() => {
          activeEnqueues.delete(enqueue);
          releaseWhenIdle();
        });
        if (disposed) return "failed";
        if (result === "queued") {
          showToast("Sending report...", "info");
          runDrain();
        } else if (result === "full") {
          showToast("Support report queue is full. Send this report again after an older one finishes.");
        } else if (result === "conflict") {
          showToast("This report conflicts with a queued report. Start a new report from Help.");
        } else if (result === "failed") {
          showToast("Couldn't save the report for upload. Keep this report open and try again.");
        }
        return result;
      });
      if (disposed) {
        unlisten();
        unlisten = null;
        return;
      }
      runDrain();
    });
    initialization = initializeOwner;
    void initializeOwner.catch((error) => {
      callbacks.onControllerError(error);
      if (!disposed) {
        showToast("Saved support reports couldn't be loaded. Uploads are paused.");
      }
    }).finally(() => {
      initialization = null;
      releaseWhenIdle();
    });

    return () => {
      disposed = true;
      unlisten?.();
      queue.dispose();
      if (retryTimerRef.current != null) window.clearTimeout(retryTimerRef.current);
      releaseWhenIdle();
    };
  }, [diagnostics, host.storage, productTelemetry, showToast, supportSnapshot, telemetry]);
}

async function drainSupportReportQueue(input: {
  queue: SupportReportQueueRuntime;
  diagnostics: DesktopDiagnosticsBridge | null;
  supportSnapshot: NonNullable<DesktopDiagnosticsBridge["supportSnapshot"]> | null;
  showToast: (message: string, type?: "error" | "info") => void;
  telemetry: SupportReportUploadTelemetry;
  isActive(): boolean;
  onLifecycleError(error: unknown): void;
}): Promise<void> {
  const showToast = (message: string, type?: "error" | "info") => {
    if (input.isActive()) input.showToast(message, type);
  };
  for (const entry of await input.queue.dueEntries(Date.now())) {
    // Hold every Blob admitted by this attempt until its serialized durable
    // disposition commits. Retry keeps the staged files but releases the
    // bounded in-memory copy only after markFailed has journalled backoff.
    const retainedBytes: Blob[] = [];
    try {
      let result: { reportId: string };
      try {
        result = await uploadSupportReportAttempt({
          job: entry.job,
          attempt: entry.attemptCount + 1,
          diagnostics: input.diagnostics,
          supportSnapshot: input.supportSnapshot,
          telemetry: input.telemetry,
          retainBytes(blob) {
            retainedBytes.push(blob);
          },
          onLifecycleError: input.onLifecycleError,
        });
      } catch (error) {
        const attemptCount = entry.attemptCount + 1;
        const failure = describeSupportReportUploadFailure(error, attemptCount);
        const legacyNeedsConsent = legacyConsentRequired(error, entry.job);
        recordUploadFailure(
          entry.job.jobId,
          legacyNeedsConsent ? "consent_required_for_legacy_job" : failure.kind,
        );

        if (failure.kind === "already_completed") {
          await input.queue.removeAndCleanup(entry.job.jobId);
          showToast(failure.toastMessage, "info");
          continue;
        }

        if (legacyNeedsConsent) {
          await input.queue.removeAndCleanup(entry.job.jobId);
          showToast(
            "This older report needs fresh diagnostic consent. Start a new report from Help.",
          );
          continue;
        }

        const exhausted = failure.retryable && supportReportRetriesExhausted({
          kind: failure.kind,
          attemptCount,
          createdAt: entry.job.createdAt,
          nowMs: Date.now(),
        });
        if (!failure.retryable || exhausted) {
          await input.queue.removeAndCleanup(entry.job.jobId);
          if (exhausted) {
            recordUploadDropped(entry.job.jobId);
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
        await input.queue.markFailed(
          entry.job.jobId,
          failure,
          new Date(nowMs),
          shouldToast,
        );
        if (shouldToast) showToast(failure.toastMessage);
        continue;
      }

      await input.queue.removeAndCleanup(entry.job.jobId);
      showToast(
        `Thanks. Report sent. Support has the details. (${result.reportId})`,
        "info",
      );
    } finally {
      retainedBytes.length = 0;
    }
  }
}

function queueCallbacks(
  showToast: (message: string, type?: "error" | "info") => void,
  captureException: (error: unknown, context?: { tags?: Record<string, string> }) => void,
): SupportReportQueueCallbacks {
  return {
    onControllerError(error) {
      captureException(error, { tags: { domain: "support_queue", action: "mutation" } });
    },
    onCleanupError(error, resource) {
      captureException(error, { tags: { domain: "support_queue", action: `cleanup_${resource}` } });
    },
    onSnapshotUnavailable(jobId, state) {
      recordUploadFailure(jobId, `snapshot_${state}`);
      showToast("A saved diagnostic snapshot is no longer available. Start a new report from Help.");
    },
  };
}

function recordUploadFailure(jobId: string, kind: string): void {
  recordRendererDiagnostic({
    name: "renderer.support.upload_failed",
    severity: "warn",
    kind: "message",
    privacy: "operational",
    fields: {
      job_id: diagnosticField(jobId, "operational"),
      failure_kind: diagnosticField(kind, "operational"),
    },
    errorClassification: kind,
  });
}

function recordUploadDropped(jobId: string): void {
  recordRendererDiagnostic({
    name: "renderer.support.upload_dropped",
    severity: "error",
    kind: "message",
    privacy: "operational",
    fields: {
      job_id: diagnosticField(jobId, "operational"),
      failure_kind: diagnosticField("exhausted", "operational"),
    },
    errorClassification: "exhausted",
  });
}
