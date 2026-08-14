import type { HTMLAttributes, ReactNode } from "react";

import { SidebarNavRow } from "#product/primitives/patterns/sidebar/SidebarNavRow";

export interface SidebarNavItemView {
  id: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  status?: ReactNode;
  shortcutLabel?: string;
  disabled?: boolean;
}

export function ProductSidebarPrimaryNavigation({
  navItems,
  onNavSelect,
  shortcutRevealVisible = false,
  gutter = true,
  className = "",
}: {
  navItems: SidebarNavItemView[];
  onNavSelect: (id: string) => void;
  shortcutRevealVisible?: boolean;
  /**
   * The sidebar's own horizontal gutter. Turn it off when the nav renders
   * inside a container that already carries one (the scrollable content's
   * viewport), so its rows stay flush with the rows around them.
   */
  gutter?: boolean;
  className?: string;
}) {
  return (
    <nav className={`${gutter ? "px-2" : ""} ${className}`}>
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
      // The sidebar's primary-nav tier; the row's em-based icon well scales
      // with it.
      className="text-sidebar-nav leading-(--text-sidebar-nav--line-height)"
      {...props}
    />
  );
}
