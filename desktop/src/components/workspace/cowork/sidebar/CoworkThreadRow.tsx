import type { CoworkThread } from "@anyharness/sdk";
import {
  BrailleSweepBadge,
  ChevronDown,
  ChevronRight,
  CircleAlert,
} from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/Tooltip";
import { SidebarRowSurface } from "@/components/workspace/shell/sidebar/SidebarRowSurface";
import type { SessionViewState } from "@/lib/domain/sessions/activity";
import { formatSidebarRelativeTime } from "@/lib/domain/workspaces/workspace-display";
import { coworkThreadTitle } from "@/lib/domain/cowork/threads";

interface CoworkThreadRowProps {
  thread: CoworkThread;
  active: boolean;
  activity?: SessionViewState;
  canExpand: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onSelect: () => void;
}

export function CoworkThreadRow({
  thread,
  active,
  activity = "idle",
  canExpand,
  expanded,
  onToggleExpanded,
  onSelect,
}: CoworkThreadRowProps) {
  const activityIndicator = activity === "working"
    ? {
      tooltip: "Working",
      element: <BrailleSweepBadge className="text-sm text-muted-foreground" />,
    }
    : activity === "needs_input"
      ? {
        tooltip: "Needs input",
        element: <BrailleSweepBadge className="text-sm text-special" />,
      }
      : activity === "errored"
        ? {
          tooltip: "Error",
          element: <CircleAlert className="size-3 text-destructive" />,
        }
        : null;

  return (
    <SidebarRowSurface
      active={active}
      onPress={onSelect}
      className="h-[30px] pl-2 pr-1 py-1 focus-visible:outline-offset-[-2px]"
    >
      <div className="flex w-full items-center gap-1.5 text-sm leading-4">
        <div className="flex w-4 shrink-0 items-center justify-center">
          {activityIndicator && (
            <Tooltip content={activityIndicator.tooltip} className="inline-flex shrink-0 items-center justify-center">
              {activityIndicator.element}
            </Tooltip>
          )}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex flex-1 items-center gap-2 truncate text-base leading-5 text-foreground">
            {coworkThreadTitle(thread)}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!active && !canExpand && (
            <div className="truncate text-right text-sm leading-4 tabular-nums text-foreground/40 group-focus-within:opacity-0 group-hover:opacity-0">
              {formatSidebarRelativeTime(thread.updatedAt)}
            </div>
          )}
          {canExpand && (
            <button
              type="button"
              aria-label={expanded ? "Hide coding workspaces" : "Show coding workspaces"}
              aria-expanded={expanded}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpanded();
              }}
              className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-offset-[-2px]"
            >
              {expanded
                ? <ChevronDown className="size-3" />
                : <ChevronRight className="size-3" />}
            </button>
          )}
        </div>
      </div>
    </SidebarRowSurface>
  );
}
