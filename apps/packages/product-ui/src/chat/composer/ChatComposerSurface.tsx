import type { HTMLAttributes, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

interface ChatComposerSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  overflowMode?: "auto" | "clip" | "visible";
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
        "chat-composer-surface relative flex flex-col rounded-[var(--radius-composer,1.5rem)]",
        overflowMode === "clip"
          ? "overflow-hidden"
          : overflowMode === "visible"
            ? "overflow-visible"
            : "overflow-y-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}
