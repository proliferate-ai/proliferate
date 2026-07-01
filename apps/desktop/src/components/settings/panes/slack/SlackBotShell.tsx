import type { ReactNode } from "react";
import { Select } from "@proliferate/ui/primitives/Select";
import { SettingsSection } from "@/components/settings/shared/SettingsSection";
import { SettingsRow } from "@/components/settings/shared/SettingsRow";
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
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <p className="max-w-[48ch] text-xs leading-[1.45] text-muted-foreground">Loading organizations...</p>
      </div>
    </SlackBotShell>
  );
}

export function SlackBotNoOrganizationState() {
  return (
    <SlackBotShell>
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <p className="max-w-[48ch] text-xs leading-[1.45] text-muted-foreground">
          Join or create an organization before configuring Slack.
        </p>
      </div>
    </SlackBotShell>
  );
}

export function SlackBotAdminLoadingState(props: OrganizationSelectorProps) {
  return (
    <SlackBotShell>
      <OrganizationSelector {...props} />
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <p className="max-w-[48ch] text-xs leading-[1.45] text-muted-foreground">Checking admin access...</p>
      </div>
    </SlackBotShell>
  );
}

export function SlackBotAdminRequiredState(props: OrganizationSelectorProps) {
  return (
    <SlackBotShell>
      <OrganizationSelector {...props} />
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <div className="text-sm font-medium text-foreground">Admin access required</div>
        <p className="max-w-[48ch] text-xs leading-[1.45] text-muted-foreground">
          Slack bot settings are available to organization owners and admins.
        </p>
      </div>
    </SlackBotShell>
  );
}
