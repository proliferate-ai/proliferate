import { type HTMLAttributes, type ReactNode } from "react";
import { SettingsEyebrow } from "./SettingsEyebrow";

export interface SettingsSectionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}

/**
 * Flat settings section — the retirement of the `SettingsCard` box.
 *
 * A section is a mono-uppercase eyebrow over a flat stack of `SettingsRow`s.
 * There is no card, border box, or elevated surface — structure comes from the
 * eyebrow and the rows' own hairline dividers. Spacing between sections is owned
 * by the parent (e.g. a `space-y-*` wrapper on the pane). An optional `action`
 * renders right-aligned on the header line, mirroring `SettingsPageHeader`.
 */
export function SettingsSection({
  title,
  description,
  action,
  children,
  className = "",
  ...props
}: SettingsSectionProps) {
  return (
    <section className={className} {...props}>
      {title || description || action ? (
        <div className="mb-1.5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title ? <SettingsEyebrow>{title}</SettingsEyebrow> : null}
            {description ? (
              <p className="mt-1 max-w-2xl text-ui-sm leading-[1.45] text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
      <div className="flex flex-col">{children}</div>
    </section>
  );
}
