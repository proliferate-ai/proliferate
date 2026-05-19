import type { HTMLAttributes, ReactNode } from "react";

import { ProductSidebarNavRow } from "@proliferate/product-ui/sidebar/ProductSidebar";

interface SidebarNavRowProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "onClick" | "onSelect"> {
  icon?: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  status?: ReactNode;
  shortcutLabel?: string;
  onPress: () => void;
}

export function SidebarNavRow({
  icon,
  label,
  active = false,
  disabled = false,
  status,
  shortcutLabel,
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
      {...props}
    />
  );
}
