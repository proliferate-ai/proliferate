import {
  SETTINGS_SCAFFOLD_COPY,
  type SettingsScaffoldPageCopy,
  type SettingsScaffoldPageId,
} from "#product/copy/settings/settings-scaffold-copy";
import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";
import { SettingsRow } from "#product/primitives/patterns/settings/SettingsRow";
import { PageHeader } from "#product/primitives/patterns/PageHeader";
import { SettingsPageBody } from "#product/primitives/patterns/settings/SettingsPageBody";

interface SettingsScaffoldPaneProps {
  pageId: SettingsScaffoldPageId;
}

export function SettingsScaffoldPane({ pageId }: SettingsScaffoldPaneProps) {
  const copy = (SETTINGS_SCAFFOLD_COPY as Record<string, SettingsScaffoldPageCopy>)[pageId];
  if (!copy) {
    return null;
  }

  return (
    <SettingsPageBody>
      <PageHeader variant="flat" title={copy.title} description={copy.description} />

      <SettingsSection>
        {copy.rows.map((row) => (
          <SettingsRow
            key={row.label}
            label={row.label}
            description={row.description}
          />
        ))}
      </SettingsSection>
    </SettingsPageBody>
  );
}
