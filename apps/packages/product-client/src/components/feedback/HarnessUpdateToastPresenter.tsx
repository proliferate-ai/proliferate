import { lazy, Suspense, useEffect, useRef } from "react";
import type { ReconcileAgentsResponse } from "@anyharness/sdk";
import { dismissToast, showToast } from "@proliferate/ui/utils/show-toast";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import { formatByteProgress } from "#product/lib/domain/updates/byte-progress";
import { getProviderDisplayName } from "#product/lib/domain/agents/provider-display";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";

const LazyCloudAnyHarnessRuntimeProvider = lazy(() =>
  import("#product/providers/CloudAnyHarnessRuntimeProvider").then((module) => ({
    default: module.CloudAnyHarnessRuntimeProvider,
  }))
);

export const HARNESS_UPDATE_TOAST_ID = "harness-update:local";
export const CLOUD_HARNESS_UPDATE_TOAST_ID = "harness-update:cloud";

interface HarnessProgressToastOptions {
  snapshot: ReconcileAgentsResponse | null;
  targetLabel: string;
  toastId: string;
}

function useHarnessProgressToast({
  snapshot,
  targetLabel,
  toastId,
}: HarnessProgressToastOptions) {
  const activeJobId = useRef<string | null>(null);
  const dismissedJobId = useRef<string | null>(null);
  const progress = snapshot?.progress ?? null;
  const isActive = snapshot?.status === "queued" || snapshot?.status === "running";

  useEffect(() => () => {
    dismissToast(toastId);
  }, [toastId]);

  useEffect(() => {
    if (!isActive || !progress) {
      if (activeJobId.current) {
        const snapshotJobId = snapshot?.jobId ?? toastId;
        const sameJob = snapshotJobId === activeJobId.current;
        const wasDismissed = dismissedJobId.current === activeJobId.current;
        const isTerminal = snapshot?.status === "completed" || snapshot?.status === "failed";
        if (sameJob && isTerminal && !wasDismissed) {
          const failed = snapshot.status === "failed"
            || progress?.components.some((component) => component.phase === "failed")
            || false;
          // The outcome is a resolution, so it gets the weight its content
          // earns: a success is a one-line receipt, a failure has a
          // consequence to state and somewhere to go.
          if (failed) {
            showToast({
              id: toastId,
              weight: "announcement",
              tone: "warning",
              title: "Some agent tools could not update",
              description: `${targetLabel}: the ones that updated are usable. Open agent settings to retry the rest.`,
            });
          } else {
            showToast({
              id: toastId,
              message: `Agent tools updated · ${targetLabel}`,
              tone: "success",
            });
          }
        } else if (!wasDismissed) {
          dismissToast(toastId);
        }
      }
      activeJobId.current = null;
      return;
    }

    const jobId = snapshot?.jobId ?? toastId;
    activeJobId.current = jobId;
    if (dismissedJobId.current === jobId) {
      return;
    }
    const current = progress.components.find((component) =>
      !["completed", "skipped", "failed"].includes(component.phase)
    );
    const currentAgent = current?.agent ?? snapshot?.currentAgent ?? null;
    const currentAgentLabel = currentAgent
      ? currentAgent === "claude"
        ? "Claude Code"
        : getProviderDisplayName(currentAgent)
      : "agent tools";
    const totalBytes = progress.downloadSizeBytes ?? null;
    const byteLabel = progress.downloadedBytes > 0 || totalBytes !== null
      ? formatByteProgress(progress.downloadedBytes, totalBytes)
      : `${progress.completedComponents} of ${progress.totalComponents} components`;

    // In-progress is a status line, not a panel. This used to be a
    // hand-authored card with its own frame, its own close button and its own
    // progress bar — a second toast look maintained by one flow. Reusing the
    // same id means each tick replaces the live toast rather than stacking, so
    // the mono suffix is the progress readout.
    showToast({
      id: toastId,
      message: `Updating ${currentAgentLabel} · ${targetLabel}`,
      code: byteLabel,
      // No advertised end: the status weight has no duration to promise, and
      // the terminal branch above replaces this toast when the job resolves.
      duration: Number.POSITIVE_INFINITY,
      onDismiss: () => {
        dismissedJobId.current = jobId;
      },
    });
  }, [isActive, progress, snapshot, targetLabel, toastId]);
}

export function HarnessUpdateToastPresenter({
  includeCloud = true,
}: {
  includeCloud?: boolean;
}) {
  const localCatalog = useAgentCatalog();
  const { cloudActive } = useCloudAvailabilityState();

  useHarnessProgressToast({
    snapshot: localCatalog.reconcileSnapshot,
    targetLabel: "This machine",
    toastId: HARNESS_UPDATE_TOAST_ID,
  });

  return includeCloud && cloudActive ? (
    <Suspense fallback={null}>
      <LazyCloudAnyHarnessRuntimeProvider>
        <CloudHarnessUpdateToast />
      </LazyCloudAnyHarnessRuntimeProvider>
    </Suspense>
  ) : null;
}

function CloudHarnessUpdateToast() {
  const cloudCatalog = useAgentCatalog();

  useHarnessProgressToast({
    snapshot: cloudCatalog.reconcileSnapshot,
    targetLabel: "Proliferate Cloud",
    toastId: CLOUD_HARNESS_UPDATE_TOAST_ID,
  });

  return null;
}
