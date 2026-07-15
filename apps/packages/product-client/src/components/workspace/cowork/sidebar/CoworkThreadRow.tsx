import type { CoworkThread } from "@anyharness/sdk";
import {
  ChevronDown,
  ChevronRight,
} from "@proliferate/ui/icons";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { SidebarStatusIndicatorView } from "#product/components/workspace/shell/sidebar/SidebarIndicators";
import type { SidebarSessionActivityState } from "@proliferate/product-domain/sessions/activity";
import { sidebarStatusIndicatorFromActivity } from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";
import { formatSidebarRelativeTime } from "#product/lib/domain/workspaces/display/workspace-display";
import { coworkThreadTitle } from "#product/lib/domain/cowork/threads";
import { ProductSidebarThreadRow } from "@proliferate/product-ui/sidebar/ProductSidebarThreads";

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
    <ProductSidebarThreadRow
      active={active}
      onSelect={onSelect}
      // Activity lives in the trailing slot, matching the workspace rows'
      // right-side convention — the leading well stays free of stacked glyphs.
      trailingStatus={activityIndicator ? (
        <SidebarStatusIndicatorView indicator={activityIndicator} />
      ) : null}
      label={coworkThreadTitle(thread)}
      trailingLabel={formatSidebarRelativeTime(thread.updatedAt)}
      expandControl={canExpand ? (
        <IconButton
          tone="sidebar"
          size="xs"
          aria-label={expanded ? "Hide coding workspaces" : "Show coding workspaces"}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpanded();
          }}
          className="rounded focus-visible:outline-offset-[-2px]"
        >
          {expanded
            ? <ChevronDown className="size-3" />
            : <ChevronRight className="size-3" />}
        </IconButton>
      ) : null}
    />
  );
}
