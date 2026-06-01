import type { ReactNode } from "react";
import { Select } from "@proliferate/ui/primitives/Select";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";

export function SlackBotShell({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Slack bot"
        description="Install and configure Slack as a team automation entrypoint."
      />
      {children}
    </section>
  );
}

export function OrganizationSelector({
  organizationId,
  organizations,
  onSelect,
}: {
  organizationId: string | null;
  organizations: Array<{ id: string; name: string }>;
  onSelect: (organizationId: string | null) => void;
}) {
  if (organizations.length <= 1) {
    return null;
  }

  return (
    <SettingsCard>
      <SettingsCardRow
        label="Active organization"
        description="Slack bot configuration is scoped to one organization."
      >
        <Select
          value={organizationId ?? ""}
          aria-label="Active organization"
          className="min-w-48"
          onChange={(event) => onSelect(event.currentTarget.value || null)}
        >
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </Select>
      </SettingsCardRow>
    </SettingsCard>
  );
}
