import type { HTMLAttributes, ReactNode } from "react";

interface ChatComposerSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function ChatComposerSurface({
  children,
  className = "",
  ...props
}: ChatComposerSurfaceProps) {
  return (
    <div
      {...props}
      className={`relative flex flex-col overflow-y-auto rounded-[var(--radius-composer)] border border-border bg-card transition-shadow shadow-xs focus-within:shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}
