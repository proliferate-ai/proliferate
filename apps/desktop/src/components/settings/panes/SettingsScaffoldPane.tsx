import {
  SETTINGS_SCAFFOLD_COPY,
  type SettingsScaffoldPageId,
} from "@/copy/settings/settings-scaffold-copy";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";

interface SettingsScaffoldPaneProps {
  pageId: SettingsScaffoldPageId;
}

export function SettingsScaffoldPane({ pageId }: SettingsScaffoldPaneProps) {
  const copy = SETTINGS_SCAFFOLD_COPY[pageId];

  return (
    <section className="space-y-6">
      <SettingsPageHeader title={copy.title} description={copy.description} />

      <SettingsSection>
        {copy.rows.map((row) => (
          <SettingsRow
            key={row.label}
            label={row.label}
            description={row.description}
          />
        ))}
      </SettingsSection>
    </section>
  );
}
