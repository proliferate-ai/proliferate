import type { HTMLAttributes, ReactNode } from "react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

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
        // [CHAT-01]/[RAD-04]: the composer owns its own 12px radius role
        // (--radius-composer). rounded-xl resolves to the same 12px today, but
        // routing through the dedicated token is what lets a consumer retune
        // just the composer (AgentHarnessConfigComposer overrides
        // --radius-composer locally) without moving every rounded-xl surface.
        "chat-composer-surface relative flex flex-col rounded-composer",
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
