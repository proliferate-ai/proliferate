import type { CoworkThread } from "@anyharness/sdk";
import {
  ChevronDown,
  ChevronRight,
} from "@/components/ui/icons";
import { SidebarStatusIndicatorView } from "@/components/workspace/shell/sidebar/SidebarIndicators";
import { SidebarRowSurface } from "@/components/workspace/shell/sidebar/SidebarRowSurface";
import type { SidebarSessionActivityState } from "@/lib/domain/sessions/activity";
import { sidebarStatusIndicatorFromActivity } from "@/lib/domain/workspaces/sidebar/sidebar";
import { formatSidebarRelativeTime } from "@/lib/domain/workspaces/display/workspace-display";
import { coworkThreadTitle } from "@/lib/domain/cowork/threads";

interface CoworkThreadRowProps {
  thread: CoworkThread;
  active: boolean;
  activity?: SidebarSessionActivityState;
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
  const activityIndicator = sidebarStatusIndicatorFromActivity({ activity });

  return (
    <SidebarRowSurface
      active={active}
      onPress={onSelect}
      className="h-[30px] pl-2 pr-1 py-1 focus-visible:outline-offset-[-2px]"
    >
      <div className="flex w-full items-center gap-1.5 text-sm leading-4">
        <div className="flex w-4 shrink-0 items-center justify-center">
          <SidebarStatusIndicatorView indicator={activityIndicator} />
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
