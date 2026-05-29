import type { HTMLAttributes, ReactNode } from "react";

import { ProductSidebarNavRow } from "@proliferate/product-ui/sidebar/ProductSidebar";

interface SidebarNavRowProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "onClick" | "onSelect"> {
  icon?: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  status?: ReactNode;
  shortcutLabel?: string;
  shortcutRevealVisible?: boolean;
  onPress: () => void;
}

export function SidebarNavRow({
  icon,
  label,
  active = false,
  disabled = false,
  status,
  shortcutLabel,
  shortcutRevealVisible,
  onPress,
  ...props
}: SidebarNavRowProps) {
  return (
    <ProductSidebarNavRow
      item={{
        id: label,
        icon,
        label,
        active,
        disabled,
        status,
        shortcutLabel,
      }}
      onSelect={onPress}
      shortcutRevealVisible={shortcutRevealVisible}
      {...props}
    />
  );
}
