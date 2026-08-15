import { type HTMLAttributes, type ReactNode } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";

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
 * Row inside a `SettingsGroup` wash card — divider-agnostic: the group owns
 * the hairline between rows, so a row never carries its own border-t/-b.
 * Label is regular weight, description sits 1px below it; the control is
 * right-aligned and `shrink-0`.
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
        "flex flex-col gap-2 px-3.5 py-[13px] sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 space-y-px">
        <div className="text-ui text-foreground">{label}</div>
        {description ? (
          <div className="max-w-2xl text-ui-sm text-muted-foreground [text-wrap:pretty]">{description}</div>
        ) : null}
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-2 sm:justify-end">{children}</div>
      ) : null}
    </div>
  );
}
