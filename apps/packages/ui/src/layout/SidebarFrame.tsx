import { type HTMLAttributes } from "react";
import { twMerge } from "../utils/tw-merge";

export function SidebarFrame({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <aside
      className={twMerge(
        "flex h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar-background text-sidebar-foreground",
        className,
      )}
      {...props}
    />
  );
}
