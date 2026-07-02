import { type HTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

/**
 * Branch-local shim: product-ui's SettingsCard was retired by the settings UX
 * revamp. This keeps the agent-auth panes compiling standalone until a later
 * UI PR restyles them onto the new settings primitives.
 */
export function SettingsCard({
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={twMerge(
        "flex flex-col overflow-hidden rounded-lg border border-border-light bg-surface-elevated text-card-foreground shadow-none",
        className,
      )}
      {...props}
    />
  );
}
