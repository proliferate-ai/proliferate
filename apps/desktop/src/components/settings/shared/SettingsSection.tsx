import { type HTMLAttributes, type ReactNode } from "react";

export interface SettingsSectionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}

/**
 * Flat settings section — the retirement of the `SettingsCard` box.
 *
 * A section is a mono-uppercase eyebrow over a flat stack of `SettingsRow`s.
 * There is no card, border box, or elevated surface — structure comes from the
 * eyebrow and the rows' own hairline dividers. Spacing between sections is owned
 * by the parent (e.g. a `space-y-*` wrapper on the pane).
 */
export function SettingsSection({
  title,
  description,
  children,
  className = "",
  ...props
}: SettingsSectionProps) {
  return (
    <section className={className} {...props}>
      {title || description ? (
        <div className="mb-1.5">
          {title ? (
            <div className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              {title}
            </div>
          ) : null}
          {description ? (
            <p className="mt-1 max-w-2xl text-[12px] leading-[1.45] text-muted-foreground">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col">{children}</div>
    </section>
  );
}
