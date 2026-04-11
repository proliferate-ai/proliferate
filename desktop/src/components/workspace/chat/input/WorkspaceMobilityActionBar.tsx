import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { ArrowUpRight, BrailleSweepBadge } from "@/components/ui/icons";
import { useWorkspaceMobility } from "@/hooks/workspaces/use-workspace-mobility";
import { WorkspaceMobilityConfirmDialog } from "./WorkspaceMobilityConfirmDialog";

export function WorkspaceMobilityActionBar() {
  const navigate = useNavigate();
  const mobility = useWorkspaceMobility();

  if (!mobility.selectedLogicalWorkspace || !mobility.repoBacked) {
    return null;
  }

  const showAction = mobility.canMoveToCloud || mobility.canBringBackLocal || mobility.action.disabledReason;
  if (!showAction) {
    return null;
  }

  return (
    <>
      <div className="mt-3 rounded-2xl border border-border/70 bg-card/75 px-3 py-2 backdrop-blur-sm">
        <div className="flex flex-col gap-2 @md:flex-row @md:items-center @md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              {mobility.status.phase !== "idle" && mobility.status.phase !== "failed" && mobility.status.phase !== "cleanup_failed" ? (
                <BrailleSweepBadge className="text-lg text-accent" />
              ) : null}
              <span>{mobility.action.label}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {mobility.action.disabledReason ?? mobility.action.description}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={Boolean(mobility.action.disabledReason) || mobility.selectionLocked || mobility.isPending}
              onClick={() => {
                void mobility.openDialog();
              }}
            >
              {mobility.action.label}
            </Button>
          </div>
        </div>

        {mobility.showMcpNotice && (
          <div className="mt-3 flex flex-col gap-2 rounded-xl border border-border/60 bg-background/80 px-3 py-2 @md:flex-row @md:items-center @md:justify-between">
            <p className="text-sm text-muted-foreground">
              Reconnect MCP tools in this environment.
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate("/powers")}
              >
                Open Powers
                <ArrowUpRight className="ml-1 size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={mobility.dismissNotice}
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}
      </div>

      <WorkspaceMobilityConfirmDialog
        snapshot={mobility.confirmSnapshot}
        open={mobility.confirmSnapshot !== null}
        isPending={mobility.isPending}
        onClose={mobility.closeDialog}
        onConfirm={mobility.confirmDialog}
      />
    </>
  );
}
