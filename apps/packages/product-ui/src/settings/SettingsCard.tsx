import { type HTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

export function SettingsCard({
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={twMerge(
        "flex flex-col overflow-hidden rounded-lg border border-border-light bg-foreground/5 text-card-foreground shadow-none",
        className,
      )}
      {...props}
    />
  );
}
