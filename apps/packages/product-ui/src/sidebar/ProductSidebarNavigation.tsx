import type { HTMLAttributes } from "react";

import { ShortcutBadge } from "@proliferate/ui/layout/ShortcutBadge";
import { SidebarRowSurface } from "@proliferate/ui/layout/SidebarRowSurface";

import type { SidebarNavItemView } from "./ProductSidebarModel";

export function ProductSidebarPrimaryNavigation({
  navItems,
  onNavSelect,
  shortcutRevealVisible = false,
  className = "",
}: {
  navItems: SidebarNavItemView[];
  onNavSelect: (id: string) => void;
  shortcutRevealVisible?: boolean;
  className?: string;
}) {
  return (
    <nav className={`px-2 ${className}`}>
      <div className="flex flex-col gap-px">
        {navItems.map((item) => (
          <ProductSidebarNavRow
            key={item.id}
            item={item}
            onSelect={onNavSelect}
            shortcutRevealVisible={shortcutRevealVisible}
          />
        ))}
      </div>
    </nav>
  );
}

export function ProductSidebarNavRow({
  item,
  onSelect,
  shortcutRevealVisible = false,
  className = "",
  ...props
}: {
  item: SidebarNavItemView;
  onSelect: (id: string) => void;
  shortcutRevealVisible?: boolean;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "onClick" | "onSelect">) {
  return (
    <SidebarRowSurface
      as="button"
      active={item.active}
      disabled={item.disabled}
      onPress={() => onSelect(item.id)}
      className={`min-h-[calc(1lh+0.5rem)] gap-2 px-2 py-1 text-sm leading-5 focus-visible:outline-offset-[-2px] ${className}`}
      {...props}
    >
      <div className="flex size-[1em] shrink-0 items-center justify-center [&>svg]:size-full [&>svg]:shrink-0">
        {item.icon}
      </div>
      <div className="flex min-w-0 flex-1 items-center text-sm leading-5 text-current">
        <span className="truncate">{item.label}</span>
      </div>
      {item.status ? (
        <span className="ml-auto shrink-0 text-xs leading-4 text-sidebar-muted-foreground">
          {item.status}
        </span>
      ) : item.shortcutLabel ? (
        <ShortcutBadge
          label={item.shortcutLabel}
          className={`shrink-0 text-sidebar-muted-foreground opacity-0 transition-opacity ${shortcutRevealVisible ? "opacity-100" : "group-hover:opacity-100 group-focus-within:opacity-100"
            }`}
        />
      ) : null}
    </SidebarRowSurface>
  );
}
