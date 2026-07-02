import { type ElementType, type ReactNode } from "react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

export const SETTINGS_EYEBROW_CLASS =
  "font-mono text-base font-medium uppercase tracking-[0.06em] text-muted-foreground";

export interface SettingsEyebrowProps {
  children: ReactNode;
  className?: string;
  /** Rendered element — defaults to a plain div. */
  as?: ElementType;
}

/**
 * Shared eyebrow label: the mono 11px uppercase group/section heading used
 * across settings surfaces (section titles, sidebar group headings, table
 * column headers).
 */
export function SettingsEyebrow({
  children,
  className,
  as: Component = "div",
}: SettingsEyebrowProps) {
  return (
    <Component className={twMerge(SETTINGS_EYEBROW_CLASS, className)}>
      {children}
    </Component>
  );
}
