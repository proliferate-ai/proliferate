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
      className={`chat-composer-surface relative flex flex-col overflow-y-auto rounded-[var(--radius-composer)] ${className}`}
    >
      {children}
    </div>
  );
}
