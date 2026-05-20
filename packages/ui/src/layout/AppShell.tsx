import { type HTMLAttributes, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

interface AppShellProps extends HTMLAttributes<HTMLDivElement> {
  sidebar?: ReactNode;
  children: ReactNode;
}

export function AppShell({ sidebar, children, className = "", ...props }: AppShellProps) {
  return (
    <div
      className={twMerge("flex h-full min-h-0 bg-background text-foreground", className)}
      {...props}
    >
      {sidebar}
      <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
