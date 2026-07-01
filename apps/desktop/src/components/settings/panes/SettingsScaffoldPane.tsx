import {
  SETTINGS_SCAFFOLD_COPY,
  type SettingsScaffoldPageId,
} from "@/copy/settings/settings-scaffold-copy";
import { SettingsSection } from "@/components/settings/shared/SettingsSection";
import { SettingsRow } from "@/components/settings/shared/SettingsRow";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";

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
