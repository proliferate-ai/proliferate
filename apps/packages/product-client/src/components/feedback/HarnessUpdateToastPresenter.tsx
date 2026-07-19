import { lazy, Suspense, useEffect, useRef } from "react";
import type { ReconcileAgentsResponse } from "@anyharness/sdk";
import { toast } from "@proliferate/ui/kit/Sonner";
import { Button } from "@proliferate/ui/primitives/Button";
import { ProgressBar } from "@proliferate/ui/primitives/ProgressBar";
import { Spinner } from "@proliferate/ui/primitives/Spinner";
import { X } from "lucide-react";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import {
  byteProgressPercent,
  formatByteProgress,
} from "#product/lib/domain/updates/byte-progress";
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

interface HarnessProgressToastCardProps {
  byteLabel: string;
  displayName: string;
  percent: number | null;
  targetLabel: string;
  onDismiss: () => void;
}

function HarnessProgressToastCard({
  byteLabel,
  displayName,
  percent,
  targetLabel,
  onDismiss,
}: HarnessProgressToastCardProps) {
  return (
    <div className="w-full rounded-xl border border-border bg-popover p-3 text-foreground shadow-md">
      <div className="flex items-start gap-3">
        <Spinner className="mt-0.5 icon-control shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-ui-sm font-medium">Updating {displayName}</p>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Dismiss agent update"
              className="-mr-1 -mt-1 shrink-0"
              onClick={onDismiss}
            >
              <X className="icon-paired" aria-hidden="true" />
            </Button>
          </div>
          <p className="mt-0.5 text-ui-xs tabular-nums text-muted-foreground">
            {targetLabel} · {byteLabel}
          </p>
          {percent !== null ? (
            <ProgressBar
              aria-label={`${targetLabel} agent tools download progress`}
              aria-valuetext={byteLabel}
              value={percent}
              className="mt-2 h-1 w-full overflow-hidden rounded-full bg-accent"
              indicatorClassName="h-full rounded-full bg-special transition-[width] duration-300"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
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
    toast.dismiss(toastId);
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
          toast(failed ? "Some agent tools could not update" : "Agent tools updated", {
            id: toastId,
            description: failed
              ? `${targetLabel}: open the harness settings for details and retry.`
              : `${targetLabel}: the installed harnesses and ACP adapters are ready.`,
            duration: 4000,
            closeButton: true,
            action: undefined,
            cancel: undefined,
          });
        } else if (!wasDismissed) {
          toast.dismiss(toastId);
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
    const percent = byteProgressPercent(progress.downloadedBytes, totalBytes);

    toast.custom(
      () => (
        <HarnessProgressToastCard
          byteLabel={byteLabel}
          displayName={currentAgentLabel}
          percent={percent}
          targetLabel={targetLabel}
          onDismiss={() => {
            dismissedJobId.current = jobId;
            toast.dismiss(toastId);
          }}
        />
      ),
      {
        id: toastId,
        duration: Infinity,
        unstyled: true,
        onDismiss: () => {
          dismissedJobId.current = jobId;
        },
      },
    );
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
