import { type ReactNode } from "react";
import { SettingsEyebrow } from "@proliferate/product-ui/settings/SettingsEyebrow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";

/**
 * How a harness auth/config block renders its title + content.
 *
 * - `"section"` — a standalone flat `SettingsSection` (eyebrow + content), the
 *   original top-to-bottom layout.
 * - `"panel"` — a padded sub-block for the setup hero panel: same eyebrow, but
 *   with the panel's internal padding and no section chrome, so several blocks
 *   stack inside one bordered panel separated by the panel's own dividers.
 */
export type HarnessBlockVariant = "section" | "panel";

interface HarnessPanelBlockProps {
  variant: HarnessBlockVariant;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}

export function HarnessPanelBlock({
  variant,
  title,
  description,
  children,
}: HarnessPanelBlockProps) {
  if (variant === "section") {
    return (
      <SettingsSection title={title} description={description}>
        {children}
      </SettingsSection>
    );
  }

  return (
    <div className="px-4 py-3.5">
      {title || description ? (
        <div className="mb-1.5 min-w-0">
          {title ? <SettingsEyebrow>{title}</SettingsEyebrow> : null}
          {description ? (
            <p className="mt-1 text-ui-sm leading-[1.45] text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col">{children}</div>
    </div>
  );
}
