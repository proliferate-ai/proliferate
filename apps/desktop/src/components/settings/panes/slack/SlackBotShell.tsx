import type { ReactNode } from "react";
import { Select } from "@proliferate/ui/primitives/Select";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";

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
    <SettingsSection>
      <SettingsRow
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
      </SettingsRow>
    </SettingsSection>
  );
}

export function SlackBotOrganizationsLoadingState() {
  return (
    <SlackBotShell>
      <SettingsEmptyState size="compact" title="Loading organizations..." />
    </SlackBotShell>
  );
}

export function SlackBotNoOrganizationState() {
  return (
    <SlackBotShell>
      <SettingsEmptyState
        size="compact"
        title="Join or create an organization before configuring Slack."
      />
    </SlackBotShell>
  );
}

export function SlackBotAdminLoadingState(props: OrganizationSelectorProps) {
  return (
    <SlackBotShell>
      <OrganizationSelector {...props} />
      <SettingsEmptyState size="compact" title="Checking admin access..." />
    </SlackBotShell>
  );
}

export function SlackBotAdminRequiredState(props: OrganizationSelectorProps) {
  return (
    <SlackBotShell>
      <OrganizationSelector {...props} />
      <SettingsEmptyState
        size="compact"
        title="Admin access required"
        description="Slack bot settings are available to organization owners and admins."
      />
    </SlackBotShell>
  );
}
