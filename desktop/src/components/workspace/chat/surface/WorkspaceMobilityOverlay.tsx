import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { useWorkspaceMobility } from "@/hooks/workspaces/use-workspace-mobility";
import { useMobilityFooterContext } from "@/hooks/workspaces/mobility/use-mobility-footer-context";
import {
  getMobilityOverlayTitle,
  MOBILITY_SUCCESS_DWELL_MS,
  mobilityReconnectCopy,
  mobilityStatusCopy,
} from "@/config/mobility-copy";
import {
  ArrowUpRight,
  CheckCircleFilled,
  CircleAlert,
  LoaderCircle,
} from "@/components/ui/icons";

type WorkspaceMobilityOverlayMode = "progress" | "cleanup_failed" | "completion";

export function WorkspaceMobilityOverlay() {
  const navigate = useNavigate();
  const mobility = useWorkspaceMobility();
  const footerContext = useMobilityFooterContext();
  const [completionVisible, setCompletionVisible] = useState(false);
  const [cleanupFailureDismissed, setCleanupFailureDismissed] = useState(false);

  useEffect(() => {
    if (mobility.status.phase === "success") {
      setCompletionVisible(true);
      if (!mobility.showMcpNotice) {
        const timer = window.setTimeout(() => {
          setCompletionVisible(false);
        }, MOBILITY_SUCCESS_DWELL_MS);
        return () => window.clearTimeout(timer);
      }
      return;
    }

    if (
      mobility.status.phase !== "cleanup_failed"
      && mobility.status.phase !== "provisioning"
      && mobility.status.phase !== "transferring"
      && mobility.status.phase !== "finalizing"
      && mobility.status.phase !== "cleanup_pending"
      && !mobility.showMcpNotice
    ) {
      setCompletionVisible(false);
    }
  }, [mobility.showMcpNotice, mobility.status.phase]);

  useEffect(() => {
    if (mobility.status.phase !== "cleanup_failed") {
      setCleanupFailureDismissed(false);
    }
  }, [mobility.status.phase]);

  const mode = useMemo(() => {
    if (
      mobility.status.phase === "provisioning"
      || mobility.status.phase === "transferring"
      || mobility.status.phase === "finalizing"
      || mobility.status.phase === "cleanup_pending"
    ) {
      return "progress" as const;
    }
    if (mobility.status.phase === "cleanup_failed") {
      if (cleanupFailureDismissed) {
        return "hidden" as const;
      }
      return "cleanup_failed" as const;
    }
    if (completionVisible || mobility.showMcpNotice) {
      return "completion" as const;
    }
    return "hidden" as const;
  }, [
    cleanupFailureDismissed,
    completionVisible,
    mobility.showMcpNotice,
    mobility.status.phase,
  ]);

  if (mode === "hidden") {
    return null;
  }

  const phase = mode === "completion" ? "success" : mobility.status.phase;
  const fallbackTitle = getMobilityOverlayTitle(mobility.status.direction, phase);
  const title = mode === "progress"
    ? fallbackTitle
    : mobility.status.title ?? fallbackTitle;
  const description =
    mobility.status.description
    ?? mobilityStatusCopy(phase, mobility.status.direction).description;
  const statusLabel = mode === "progress"
    ? mobilityStatusCopy(mobility.status.phase, mobility.status.direction).title
    : null;

  return (
    <WorkspaceMobilityOverlayView
      description={description}
      locationLabel={footerContext?.locationLabel ?? null}
      mcpNotice={mobility.showMcpNotice
        ? mobilityReconnectCopy(mobility.status.direction)
        : null}
      mode={mode}
      onContinueWorking={() => setCleanupFailureDismissed(true)}
      onDismissNotice={mobility.dismissNotice}
      onOpenPowers={() => navigate("/powers")}
      onRetryCleanup={() => {
        void mobility.retryCleanup();
      }}
      statusLabel={statusLabel}
      title={title}
    />
  );
}

export function WorkspaceMobilityOverlayView({
  description,
  locationLabel,
  mcpNotice,
  mode,
  onContinueWorking,
  onDismissNotice,
  onOpenPowers,
  onRetryCleanup,
  statusLabel,
  title,
}: {
  description: string | null;
  locationLabel: string | null;
  mcpNotice?: string | null;
  mode: WorkspaceMobilityOverlayMode;
  onContinueWorking?: () => void;
  onDismissNotice?: () => void;
  onOpenPowers?: () => void;
  onRetryCleanup?: () => void;
  statusLabel?: string | null;
  title: string;
}) {
  const icon = mode === "progress"
    ? <LoaderCircle className="size-4 animate-spin" />
    : mode === "cleanup_failed"
      ? <CircleAlert className="size-4" />
      : <CheckCircleFilled className="size-4" />;
  const iconTone = mode === "cleanup_failed"
    ? "bg-destructive/10 text-destructive"
    : "bg-foreground/8 text-foreground";

  return (
    <div className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-background/70 px-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-xl border border-border/70 bg-card/95 p-5 text-left shadow-floating">
        <div className="flex items-start gap-3">
          <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${iconTone}`}>
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            {locationLabel && (
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground/80">
                {locationLabel}
              </p>
            )}
            <h2 className="mt-1 text-lg font-medium tracking-tight text-foreground">
              {title}
            </h2>
            {description && (
              <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>

        {mode === "progress" && statusLabel && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-foreground/6 px-3 py-1.5 text-sm text-muted-foreground">
            <LoaderCircle className="size-3 animate-spin text-foreground" />
            <span>{statusLabel}</span>
          </div>
        )}

        {mode === "completion" && mcpNotice && (
          <div className="mt-4 rounded-lg bg-foreground/6 p-3">
            <p className="text-sm text-muted-foreground">
              {mcpNotice}
            </p>
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={onDismissNotice}
              >
                Dismiss
              </Button>
              <Button
                size="sm"
                onClick={onOpenPowers}
              >
                Open Powers
                <ArrowUpRight className="ml-1 size-3.5" />
              </Button>
            </div>
          </div>
        )}

        {mode === "cleanup_failed" && (
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              size="sm"
              onClick={onRetryCleanup}
            >
              Retry cleanup
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onContinueWorking}
            >
              Continue working
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
