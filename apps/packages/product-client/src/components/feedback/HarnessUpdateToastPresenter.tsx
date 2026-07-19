import { useEffect, useRef } from "react";
import type { ReconcileAgentsResponse } from "@anyharness/sdk";
import { toast } from "@proliferate/ui/kit/Sonner";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { ProgressBar } from "@proliferate/ui/primitives/ProgressBar";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import {
  byteProgressPercent,
  formatByteProgress,
} from "#product/lib/domain/updates/byte-progress";
import { getProviderDisplayName } from "#product/lib/domain/agents/provider-display";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import { CloudAnyHarnessRuntimeProvider } from "#product/providers/CloudAnyHarnessRuntimeProvider";

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
      ? getProviderDisplayName(currentAgent)
      : "agent tools";
    const totalBytes = progress.downloadSizeBytes ?? null;
    const byteLabel = progress.downloadedBytes > 0 || totalBytes !== null
      ? formatByteProgress(progress.downloadedBytes, totalBytes)
      : `${progress.completedComponents} of ${progress.totalComponents} components`;
    const percent = byteProgressPercent(progress.downloadedBytes, totalBytes);

    toast(
      <span className="flex min-w-0 flex-col items-start gap-1.5">
        <Badge className="shrink-0">AGENTS</Badge>
        <span>Updating {currentAgentLabel}</span>
      </span>,
      {
        id: toastId,
        description: (
          <span className="block">
            <span className="block text-xs tabular-nums text-muted-foreground">
              {targetLabel} · {byteLabel}
            </span>
            {percent !== null ? (
              <ProgressBar
                aria-label={`${targetLabel} agent tools download progress`}
                aria-valuetext={byteLabel}
                value={percent}
                className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-accent"
                indicatorClassName="h-full rounded-full bg-special transition-[width] duration-300"
              />
            ) : null}
          </span>
        ),
        duration: Infinity,
        closeButton: true,
        onDismiss: () => {
          dismissedJobId.current = jobId;
        },
        action: undefined,
        cancel: undefined,
      },
    );
  }, [isActive, progress, snapshot, targetLabel, toastId]);
}

export function HarnessUpdateToastPresenter() {
  const localCatalog = useAgentCatalog();

  useHarnessProgressToast({
    snapshot: localCatalog.reconcileSnapshot,
    targetLabel: "This machine",
    toastId: HARNESS_UPDATE_TOAST_ID,
  });

  return <CloudHarnessUpdateToastPresenter />;
}

function CloudHarnessUpdateToastPresenter() {
  const { cloudActive } = useCloudAvailabilityState();

  return cloudActive ? (
    <CloudAnyHarnessRuntimeProvider>
      <CloudHarnessUpdateToast />
    </CloudAnyHarnessRuntimeProvider>
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
