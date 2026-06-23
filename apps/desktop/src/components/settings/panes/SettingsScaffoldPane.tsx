import {
  SETTINGS_SCAFFOLD_COPY,
  type SettingsScaffoldPageId,
} from "@/copy/settings/settings-scaffold-copy";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";

interface SettingsScaffoldPaneProps {
  pageId: SettingsScaffoldPageId;
}

export function SettingsScaffoldPane({ pageId }: SettingsScaffoldPaneProps) {
  const copy = SETTINGS_SCAFFOLD_COPY[pageId];

  return (
    <section className="space-y-6">
      <SettingsPageHeader title={copy.title} description={copy.description} />

      <SettingsCard>
        {copy.rows.map((row) => (
          <SettingsCardRow
            key={row.label}
            label={row.label}
            description={row.description}
          />
        ))}
      </SettingsCard>
    </section>
  );
}
