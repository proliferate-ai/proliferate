import type { HTMLAttributes, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

interface ComposerPopoverSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function ComposerPopoverSurface({
  children,
  className = "",
  ...props
}: ComposerPopoverSurfaceProps) {
  // Overlay recipe (UX_SPEC §5/§7): popover bg, 0.5px ring, 12px radius,
  // 4px padding, overlay shadow, backdrop blur.
  return (
    <div
      {...props}
      className={twMerge(
        "rounded-xl bg-popover/90 p-1 text-popover-foreground shadow-popover ring-[0.5px] ring-popover-ring backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}
