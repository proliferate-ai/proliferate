import { SidebarActionButton } from "@proliferate/ui/layout/SidebarActionButton";

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
    <SidebarActionButton
      title={action.label}
      alwaysVisible={alwaysVisible}
      disabled={action.disabled}
      onClick={(event) => {
        event.stopPropagation();
        onAction({ scope, itemId, actionId: action.id });
      }}
      className={`${action.destructive ? "text-destructive hover:text-destructive" : ""
        } ${alwaysVisible ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
    >
      {action.icon ?? <span className="text-[10px] leading-none">...</span>}
    </SidebarActionButton>
  );
}
