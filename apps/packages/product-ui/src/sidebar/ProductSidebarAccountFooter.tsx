import type { SidebarAccountView, SidebarActionEvent } from "./ProductSidebarModel";
import { SidebarActionIconButton } from "./ProductSidebarActionButton";

export function AccountFooter({
  account,
  onAction,
}: {
  account: SidebarAccountView;
  onAction: (event: SidebarActionEvent) => void;
}) {
  return (
    <div className="shrink-0 border-t border-sidebar-border/75 px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sidebar-accent text-xs font-medium text-sidebar-foreground">
          {account.avatarUrl ? (
            <img src={account.avatarUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            account.initials
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm leading-4 text-sidebar-foreground">
            {account.label}
          </div>
          {account.detail ? (
            <div className="truncate text-xs leading-4 text-sidebar-muted-foreground">
              {account.detail}
            </div>
          ) : null}
        </div>
        {(account.actions ?? []).map((action) => (
          <SidebarActionIconButton
            key={action.id}
            action={action}
            scope="account"
            onAction={onAction}
            alwaysVisible
          />
        ))}
      </div>
    </div>
  );
}
