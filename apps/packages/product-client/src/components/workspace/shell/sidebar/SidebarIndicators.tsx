import type { MouseEvent, ReactNode } from "react";
import { CircleAlert } from "#product/primitives/icons/status";
import { Clock } from "#product/primitives/icons/core";
import { DotCellLoader } from "#product/primitives/DotCellLoader";
import { IconButton } from "#product/primitives/IconButton";
import { Tooltip } from "#product/primitives/Tooltip";
import type {
  SidebarIndicatorAction,
  SidebarStatusIndicator,
} from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";

interface SidebarStatusIndicatorViewProps {
  indicator: SidebarStatusIndicator | null | undefined;
  onAction?: (action: SidebarIndicatorAction) => void;
}

interface SidebarStatusGlyphProps {
  indicator: SidebarStatusIndicator;
}

export function SidebarStatusGlyph({
  indicator,
}: SidebarStatusGlyphProps): ReactNode {
  switch (indicator.kind) {
    case "error":
      return <CircleAlert className="icon-compact text-sidebar-status-error [font-size:var(--text-sidebar-row)]" />;
    case "worktree_missing":
      return <CircleAlert className="icon-compact text-sidebar-status-error [font-size:var(--text-sidebar-row)]" />;
    case "waiting_input":
    case "waiting_plan":
      // Quiet ink: waiting is a resting state, not an alert. The row still
      // says why through the indicator's tooltip, and the status inks stay
      // reserved for the states that genuinely need eyes (error, conflicts).
      return <Clock className="icon-compact text-sidebar-muted-foreground [font-size:var(--text-sidebar-row)]" />;
    case "iterating":
    case "queued_prompt":
      return (
        <DotCellLoader
          aria-hidden="true"
          size="compact"
          variant="wave"
          className="text-sidebar-muted-foreground"
        />
      );
  }
}

export const SIDEBAR_GIT_CONFLICTS_LABEL = "Merge conflicts in worktree";

/**
 * Merge conflicts, rendered in the row's STATUS cell rather than beside the
 * git identity glyph. Conflicts are a "this needs you" alert like the error
 * and waiting indicators around it, not part of the row's PR identity; the
 * other two attention states (failing checks, changes requested) are already
 * the identity glyph's state dot and are deliberately not repeated here.
 *
 * It occupies the same fixed 20px cell as `SidebarStatusIndicatorView`, so a
 * row swapping between conflicts and live activity does not shift.
 */
export function SidebarGitConflictsAlert() {
  return (
    <Tooltip
      content={SIDEBAR_GIT_CONFLICTS_LABEL}
      className="flex h-5 min-w-5 shrink-0 items-center justify-center"
    >
      <span
        role="img"
        aria-label={SIDEBAR_GIT_CONFLICTS_LABEL}
        className="flex h-5 min-w-5 items-center justify-center"
      >
        <CircleAlert className="icon-compact text-sidebar-status-waiting [font-size:var(--text-sidebar-row)]" />
      </span>
    </Tooltip>
  );
}

export function SidebarStatusIndicatorView({
  indicator,
  onAction,
}: SidebarStatusIndicatorViewProps) {
  if (!indicator) {
    return null;
  }

  const action = "action" in indicator ? indicator.action : null;
  const glyph = <SidebarStatusGlyph indicator={indicator} />;

  // Both branches occupy the same fixed 20px cell (h-5 min-w-5, centered) so
  // the glyph's vertical center is identical whether or not the indicator is
  // actionable — mixed cell sizes are what made adjacent rows' indicators sit
  // at visibly different heights.
  return (
    <Tooltip content={indicator.tooltip} className="flex h-5 min-w-5 shrink-0 items-center justify-center">
      {action && onAction ? (
        <IconButton
          tone="sidebar"
          size="sm"
          title={indicator.tooltip}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            onAction(action);
          }}
          className="!size-5 !p-0 hover:bg-transparent"
        >
          {glyph}
        </IconButton>
      ) : (
        <span role="img" aria-label={indicator.tooltip} className="flex h-5 min-w-5 items-center justify-center">{glyph}</span>
      )}
    </Tooltip>
  );
}
