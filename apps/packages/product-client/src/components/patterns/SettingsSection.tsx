import { type HTMLAttributes, type ReactNode } from "react";
import { SettingsGroup } from "#product/primitives/patterns/SettingsGroup";

export interface SettingsSectionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** @default "muted" */
  titleWeight?: "muted" | "emphasized";
  /** @default "group" */
  surface?: "group" | "plain";
  children?: ReactNode;
}

/**
 * Settings section — a sentence-case label over the wash card
 * (`SettingsGroup`).
 *
 * `titleWeight="muted"` (default) is the header used above a card of rows:
 * a small muted label, no description emphasis. `titleWeight="emphasized"`
 * promotes the title to body weight for sections that read as their own
 * mini-heading rather than a card caption (see the "Archiving" block on the
 * archived-workspaces pane).
 *
 * `surface="plain"` opts out of the wash card entirely and is reserved for
 * content that must not sit in a tinted card: previews already on
 * `bg-background`, `SettingsEmptyState`, self-carded dashboards.
 */
export function SettingsSection({
  title,
  description,
  action,
  titleWeight = "muted",
  surface = "group",
  children,
  className = "",
  ...props
}: SettingsSectionProps) {
  const emphasized = titleWeight === "emphasized";

  return (
    <section className={className} {...props}>
      {title || description || action ? (
        <div className="mb-2 flex items-end justify-between gap-3">
          <div className={emphasized ? "flex min-w-0 flex-col gap-1" : "min-w-0"}>
            {title ? (
              <div className={emphasized ? "text-ui font-medium text-foreground" : "px-0.5 text-ui-sm text-muted-foreground"}>
                {title}
              </div>
            ) : null}
            {description ? (
              <p className={emphasized ? "text-ui text-muted-foreground" : "mt-1 max-w-2xl text-ui-sm text-muted-foreground"}>
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
      {surface === "plain" ? <div className="flex flex-col">{children}</div> : <SettingsGroup>{children}</SettingsGroup>}
    </section>
  );
}
