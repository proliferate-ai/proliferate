import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import { SidebarRowSurface } from "@proliferate/ui/layout/SidebarRowSurface";

export interface SettingsSectionItem {
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  status?: ReactNode;
}

export interface SettingsSidebarGroup {
  label?: string;
  items: SettingsSectionItem[];
}

export interface SettingsShellProps {
  activeSectionId: string;
  groups: SettingsSidebarGroup[];
  children: ReactNode;
  onSelectSection: (id: string) => void;
  onNavigateHome?: () => void;
  updateAction?: ReactNode;
  className?: string;
}

export function SettingsShell({
  activeSectionId,
  groups,
  children,
  onSelectSection,
  onNavigateHome,
  updateAction,
  className = "",
}: SettingsShellProps) {
  return (
    <div
      className={twMerge(
        "flex h-full min-h-0 bg-background text-foreground",
        className,
      )}
    >
      <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-border bg-sidebar px-3 py-4 text-sidebar-foreground">
        <div className="mb-4 flex items-center gap-2 px-2">
          <div className="text-sm font-semibold text-sidebar-foreground">Settings</div>
        </div>

        {onNavigateHome ? (
          <div className="mb-3">
            <SidebarRowSurface as="button" onPress={onNavigateHome}>
              <span className="truncate">Back to app</span>
            </SidebarRowSurface>
          </div>
        ) : null}

        <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto">
          {groups.map((group, groupIndex) => (
            <div key={group.label ?? `settings-group-${groupIndex}`} className="space-y-1">
              {group.label ? (
                <div className="px-2 pb-1 text-[10.5px] font-semibold uppercase text-sidebar-muted-foreground">
                  {group.label}
                </div>
              ) : null}
              {group.items.map((item) => (
                <SidebarRowSurface
                  key={item.id}
                  as="button"
                  active={item.id === activeSectionId}
                  disabled={item.disabled}
                  onPress={() => onSelectSection(item.id)}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center text-sidebar-muted-foreground">
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.status ? <span className="shrink-0">{item.status}</span> : null}
                </SidebarRowSurface>
              ))}
            </div>
          ))}
        </nav>

        {updateAction ? (
          <div className="mt-4 border-t border-sidebar-border pt-3">{updateAction}</div>
        ) : null}
      </aside>

      <main className="min-w-0 flex-1">
        <AutoHideScrollArea className="h-full">
          <div className="mx-auto w-full max-w-3xl px-8 py-10">{children}</div>
        </AutoHideScrollArea>
      </main>
    </div>
  );
}
