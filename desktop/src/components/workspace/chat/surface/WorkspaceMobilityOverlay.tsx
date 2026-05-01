import { Button } from "@/components/ui/Button";
import {
  type WorkspaceMobilityOverlayMode,
  useWorkspaceMobilityOverlayState,
} from "@/hooks/workspaces/mobility/use-workspace-mobility-overlay-state";
import {
  CheckCircleFilled,
  CircleAlert,
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
  mcpNotice,
  mode,
  onContinueWorking,
  onDismissNotice,
  onRetryCleanup,
  title,
}: {
  description: string | null;
  mcpNotice?: string | null;
  mode: WorkspaceMobilityOverlayMode;
  onContinueWorking?: () => void;
  onDismissNotice?: () => void;
  onRetryCleanup?: () => void;
  title: string;
}) {
  const icon = mode === "cleanup_failed"
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
            <h2 className="text-lg font-medium tracking-tight text-foreground">
              {title}
            </h2>
            {description && (
              <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>

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
