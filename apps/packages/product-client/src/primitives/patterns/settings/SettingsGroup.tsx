import { Children, Fragment, type ReactNode } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";

export interface SettingsGroupProps {
  children?: ReactNode;
  className?: string;
  label?: ReactNode;
  empty?: ReactNode;
}

/**
 * The settings/list wash surface: a borderless, tinted card that owns the
 * divider between adjacent children, so rows never carry their own
 * border-t/-b. The archived-workspaces list card composes this directly,
 * using `empty` for its no-results state.
 */
export function SettingsGroup({ children, className, label, empty }: SettingsGroupProps) {
  const items = Children.toArray(children);

  const card = (
    <div className={twMerge("rounded-xl bg-surface-elevated-secondary overflow-hidden", className)}>
      {items.length > 0
        ? items.map((child, index) => (
            <Fragment key={index}>
              {index > 0 ? <div aria-hidden className="mx-3.5 h-px bg-border-light" /> : null}
              {child}
            </Fragment>
          ))
        : empty
          ? <div className="px-6 py-[30px] text-center text-ui text-muted-foreground">{empty}</div>
          : null}
    </div>
  );

  if (!label) return card;

  return (
    <div className="flex flex-col gap-2">
      <div className="px-0.5 text-ui-sm text-muted-foreground">{label}</div>
      {card}
    </div>
  );
}
