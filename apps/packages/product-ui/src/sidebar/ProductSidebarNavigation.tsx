import type { HTMLAttributes } from "react";

import { SidebarNavRow } from "@proliferate/ui/layout/SidebarNavRow";

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
  ...props
}: {
  item: SidebarNavItemView;
  onSelect: (id: string) => void;
  shortcutRevealVisible?: boolean;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "onClick" | "onSelect">) {
  return (
    <SidebarNavRow
      icon={item.icon}
      label={item.label}
      active={item.active}
      disabled={item.disabled}
      status={item.status}
      shortcutLabel={item.shortcutLabel}
      shortcutRevealVisible={shortcutRevealVisible}
      onPress={() => onSelect(item.id)}
      {...props}
    />
  );
}
