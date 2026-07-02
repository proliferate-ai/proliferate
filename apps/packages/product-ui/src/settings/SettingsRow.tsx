import { type HTMLAttributes, type ReactNode } from "react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

/**
 * Shared width for right-aligned row controls (menus, selects) and their
 * popover menus — 240px. Menu width always matches trigger width.
 */
export const SETTINGS_CONTROL_WIDTH_CLASS = "w-60";

export interface SettingsRowProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}

/**
 * Flat settings row — the retirement of `SettingsCardRow`.
 *
 * Rows sit directly on the page background (no card layer) and are separated
 * from each other by a `border-border` hairline via `border-t` / `first:border-t-0`,
 * so a group of rows reads as one flat list. Label is 13/medium, description is
 * 12/muted; the control is right-aligned and `shrink-0`. Drop-in prop-compatible
 * with `SettingsCardRow`.
 */
export function SettingsRow({
  label,
  description,
  children,
  className = "",
  ...props
}: SettingsRowProps) {
  return (
    <div
      className={twMerge(
        "flex min-h-[2.875rem] flex-col gap-2 border-t border-border py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 space-y-1">
        <div className="text-ui font-medium leading-5 text-foreground">{label}</div>
        {description ? (
          <div className="max-w-2xl text-ui-sm leading-[1.45] text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-2 sm:justify-end">{children}</div>
      ) : null}
    </div>
  );
}
