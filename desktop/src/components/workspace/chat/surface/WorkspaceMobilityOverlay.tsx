import { Button } from "@/components/ui/Button";
import type { WorkspaceMobilityDirection } from "@/stores/workspaces/workspace-mobility-ui-store";
import {
  type WorkspaceMobilityOverlayMode,
  useWorkspaceMobilityOverlayState,
} from "@/hooks/workspaces/mobility/use-workspace-mobility-overlay-state";
import {
  CheckCircleFilled,
  CircleAlert,
  CloudIcon,
  FolderOpen,
  LoaderCircle,
} from "@/components/ui/icons";

export function WorkspaceMobilityOverlay() {
  const overlayState = useWorkspaceMobilityOverlayState();

  if (!overlayState) {
    return null;
  }

  return (
    <WorkspaceMobilityOverlayView
      {...overlayState}
    />
  );
}

export function WorkspaceMobilityOverlayView({
  description,
  direction,
  locationLabel,
  mcpNotice,
  mode,
  onContinueWorking,
  onDismissNotice,
  onRetryCleanup,
  statusLabel,
  title,
}: {
  description: string | null;
  direction?: WorkspaceMobilityDirection | null;
  locationLabel: string | null;
  mcpNotice?: string | null;
  mode: WorkspaceMobilityOverlayMode;
  onContinueWorking?: () => void;
  onDismissNotice?: () => void;
  onRetryCleanup?: () => void;
  statusLabel?: string | null;
  title: string;
}) {
  const icon = mode === "progress"
    ? direction === "cloud_to_local"
      ? <FolderOpen className="size-4" />
      : <CloudIcon className="size-4" />
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
            <div className="mt-3 flex items-center justify-end">
              <Button
                size="sm"
                onClick={onDismissNotice}
              >
                Use workspace
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
