import { Badge } from "@/components/ui/Badge";
import { BrailleSweepBadge } from "@/components/ui/icons";
import { ComposerAttachedPanel } from "@/components/workspace/chat/input/ComposerAttachedPanel";
import { useWorkspaceMobilityState } from "@/hooks/workspaces/mobility/use-workspace-mobility-state";

function badgeLabel(phase: string): string {
  switch (phase) {
    case "provisioning":
      return "Provisioning";
    case "transferring":
      return "Transferring";
    case "finalizing":
      return "Finalizing";
    case "cleanup_pending":
      return "Cleaning up";
    case "cleanup_failed":
      return "Cleanup failed";
    case "failed":
      return "Failed";
    case "success":
      return "Complete";
    default:
      return "Mobility";
  }
}

const ANIMATED_PHASES = new Set(["provisioning", "transferring", "finalizing"]);

export function WorkspaceMobilityAttachedPanel() {
  const mobility = useWorkspaceMobilityState();

  if (mobility.status.phase === "idle") {
    return null;
  }

  return (
    <ComposerAttachedPanel
      header={(
        <>
          <Badge className="shrink-0 rounded-full px-2 py-0.5 text-base">
            <span className="inline-flex items-center gap-1">
              {ANIMATED_PHASES.has(mobility.status.phase) && (
                <BrailleSweepBadge className="text-lg text-accent" />
              )}
              <span>{badgeLabel(mobility.status.phase)}</span>
            </span>
          </Badge>
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {mobility.status.title}
          </span>
          {mobility.status.description && (
            <span className="truncate text-sm text-muted-foreground">
              {mobility.status.description}
            </span>
          )}
        </>
      )}
      expanded={false}
    />
  );
}
