import type { HTMLAttributes, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

interface ChatComposerSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  overflowMode?: "auto" | "clip";
}

export function ChatComposerSurface({
  children,
  className = "",
  overflowMode = "auto",
  ...props
}: ChatComposerSurfaceProps) {
  return (
    <div
      {...props}
      data-chat-composer-surface="true"
      className={twMerge(
        "chat-composer-surface relative flex flex-col rounded-[var(--radius-composer)]",
        overflowMode === "clip" ? "overflow-hidden" : "overflow-y-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}
