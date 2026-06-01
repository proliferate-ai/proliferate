import type { SidebarActionEvent, SidebarActionView } from "./ProductSidebarModel";
import { SidebarActionIconButton } from "./ProductSidebarActionButton";

export function ProductSidebarFooter({
  actions,
  onAction,
}: {
  actions: SidebarActionView[];
  onAction: (event: SidebarActionEvent) => void;
}) {
  return (
    <div className="shrink-0">
      <div className="flex shrink-0 items-center justify-end gap-1 border-t border-sidebar-border/75 px-3 py-2">
        {actions.map((action) => (
          <SidebarActionIconButton
            key={action.id}
            action={action}
            scope="footer"
            onAction={onAction}
            alwaysVisible
          />
        ))}
      </div>
    </div>
  );
}
