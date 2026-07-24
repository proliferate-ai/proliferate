import { RowActionIconButton } from "@proliferate/ui/layout/RowActionIconButton";

import type { SidebarActionEvent, SidebarActionScope, SidebarActionView } from "./ProductSidebarModel";

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
    <RowActionIconButton
      label={action.label}
      visibility={alwaysVisible ? "always" : "reveal"}
      disabled={action.disabled}
      onClick={() => {
        onAction({ scope, itemId, actionId: action.id });
      }}
      className={action.destructive ? "text-destructive hover:text-destructive" : undefined}
    >
      {action.icon ?? <span className="text-ui leading-none">...</span>}
    </RowActionIconButton>
  );
}
