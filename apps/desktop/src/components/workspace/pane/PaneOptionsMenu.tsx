import type { ReactNode } from "react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { MoreHorizontal } from "@proliferate/ui/icons";
import { PaneIconButton } from "@proliferate/ui/layout/PaneIconButton";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";

export function PaneOptionsMenu({
  label = "Pane options",
  align = "end",
  className = "",
  triggerClassName = "",
  children,
}: {
  label?: string;
  align?: "start" | "end";
  className?: string;
  triggerClassName?: string;
  children: (close: () => void) => ReactNode;
}) {
  return (
    <PopoverButton
      trigger={(
        <PaneIconButton label={label} className={triggerClassName}>
          <MoreHorizontal className="size-3.5" />
        </PaneIconButton>
      )}
      align={align}
      className={twMerge("min-w-[200px]", POPOVER_SURFACE_CLASS, className)}
    >
      {children}
    </PopoverButton>
  );
}

export function PaneOptionsMenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}
