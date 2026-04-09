import type { HTMLAttributes, ReactNode } from "react";

interface ChatComposerSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  flatTop?: boolean;
}

export function ChatComposerSurface({
  children,
  className = "",
  flatTop = false,
  ...props
}: ChatComposerSurfaceProps) {
  const rounding = flatTop
    ? "rounded-b-[var(--radius-composer)] rounded-t-none border-t-0"
    : "rounded-[var(--radius-composer)]";

  return (
    <div
      {...props}
      className={`relative flex flex-col overflow-y-auto ${rounding} border border-border bg-card transition-shadow shadow-xs focus-within:shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}
