import { SidebarActionButton } from "@proliferate/ui/layout/SidebarActionButton";

import type { SidebarActionEvent, SidebarActionScope, SidebarActionView } from "./ProductSidebarModel";

/**
 * [ROW-ACTION-01]: `alwaysVisible` alone drives the reveal/hidden decision
 * — `SidebarActionButton` (itself a thin adapter over the shared
 * `RowActionIconButton` primitive) already owns the reveal-on-group-hover
 * classes, so this adapter only supplies destructive-tone coloring and
 * never re-declares opacity/visibility.
 */
export function SidebarActionIconButton({
  action,
  scope,
  itemId,
  onAction,
  alwaysVisible = false,
}: {
  action: SidebarActionView;
  scope: SidebarActionScope;
  itemId?: string;
  onAction: (event: SidebarActionEvent) => void;
  alwaysVisible?: boolean;
}) {
  return (
    <SidebarActionButton
      title={action.label}
      alwaysVisible={alwaysVisible}
      disabled={action.disabled}
      onClick={(event) => {
        event.stopPropagation();
        onAction({ scope, itemId, actionId: action.id });
      }}
      className={action.destructive ? "text-destructive hover:text-destructive" : ""}
    >
      {action.icon ?? <span className="text-ui leading-none">...</span>}
    </SidebarActionButton>
  );
}
