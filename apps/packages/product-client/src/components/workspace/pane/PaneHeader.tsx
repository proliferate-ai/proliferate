import type { ReactNode } from "react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

export function PaneHeader({
  left,
  right,
  className = "",
}: {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={twMerge(
        "z-20 flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-sidebar-border/70 px-2 text-sidebar-foreground",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">{left}</div>
      {right && <div className="flex shrink-0 items-center gap-1">{right}</div>}
    </div>
  );
}
