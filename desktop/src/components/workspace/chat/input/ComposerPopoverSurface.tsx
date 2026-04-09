import type { HTMLAttributes, ReactNode } from "react";

interface ComposerPopoverSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function ComposerPopoverSurface({
  children,
  className = "",
  ...props
}: ComposerPopoverSurfaceProps) {
  return (
    <div
      {...props}
      className={`rounded-[18px] border border-border/60 bg-popover/96 p-1.5 text-popover-foreground shadow-floating backdrop-blur-lg ${className}`}
    >
      {children}
    </div>
  );
}
