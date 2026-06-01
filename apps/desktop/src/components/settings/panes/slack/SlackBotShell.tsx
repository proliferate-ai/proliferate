import type { ReactNode } from "react";
import { Select } from "@proliferate/ui/primitives/Select";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";

interface OrganizationSelectorProps {
  organizationId: string | null;
  organizations: Array<{ id: string; name: string }>;
  onSelect: (organizationId: string | null) => void;
}

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
}: OrganizationSelectorProps) {
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

export function SlackBotOrganizationsLoadingState() {
  return (
    <SlackBotShell>
      <SettingsCard>
        <div className="p-3 text-sm text-muted-foreground">Loading organizations...</div>
      </SettingsCard>
    </SlackBotShell>
  );
}

export function SlackBotNoOrganizationState() {
  return (
    <SlackBotShell>
      <SettingsCard>
        <div className="p-3 text-sm text-muted-foreground">
          Join or create an organization before configuring Slack.
        </div>
      </SettingsCard>
    </SlackBotShell>
  );
}

export function SlackBotAdminLoadingState(props: OrganizationSelectorProps) {
  return (
    <SlackBotShell>
      <OrganizationSelector {...props} />
      <SettingsCard>
        <div className="p-3 text-sm text-muted-foreground">Checking admin access...</div>
      </SettingsCard>
    </SlackBotShell>
  );
}

export function SlackBotAdminRequiredState(props: OrganizationSelectorProps) {
  return (
    <SlackBotShell>
      <OrganizationSelector {...props} />
      <SettingsCard>
        <div className="space-y-1 p-3">
          <p className="text-sm font-medium text-foreground">Admin access required</p>
          <p className="text-sm text-muted-foreground">
            Slack bot settings are available to organization owners and admins.
          </p>
        </div>
      </SettingsCard>
    </SlackBotShell>
  );
}
