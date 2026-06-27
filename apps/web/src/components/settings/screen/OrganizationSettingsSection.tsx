import type { FormEvent } from "react";

import { SettingsCard } from "@proliferate/product-ui/settings/SettingsCard";
import { SettingsCardRow } from "@proliferate/product-ui/settings/SettingsCardRow";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { CloudSecretsSettingsSurface } from "@proliferate/product-surfaces/settings/CloudSecretsSettingsSurface";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";

import { useWebOrganizationSettings } from "../../../hooks/settings/facade/use-web-organization-settings";

export function OrganizationSettingsSection() {
  const organization = useWebOrganizationSettings();

  function handleCreateTeam(event: FormEvent) {
    event.preventDefault();
    void organization.createTeam();
  }

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Organization"
        description="Create or join one team for shared work, members, invites, and organization billing."
      />
      {organization.actionError ? (
        <SettingsCard>
          <SettingsCardRow label="Action failed" description={organization.actionError} />
        </SettingsCard>
      ) : null}
      {organization.pendingCheckoutIntent && !organization.currentTeam ? (
        <SettingsCard>
          <SettingsCardRow
            label={organization.pendingCheckoutIntent.teamName}
            description="Team checkout is pending. Continue checkout or cancel setup."
          >
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={organization.continueCheckout}
              >
                Continue
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={organization.cancelingTeamCheckout}
                onClick={organization.cancelCheckout}
              >
                Cancel
              </Button>
            </div>
          </SettingsCardRow>
        </SettingsCard>
      ) : null}
      <SettingsCard>
        {organization.currentTeamLoading ? (
          <SettingsCardRow label="Organization" description="Loading team..." />
        ) : organization.currentTeamError ? (
          <SettingsCardRow
            label="Organization"
            description="Team could not be loaded."
          >
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={organization.retryCurrentTeam}
            >
              Retry
            </Button>
          </SettingsCardRow>
        ) : organization.currentTeam ? (
          <SettingsCardRow
            label={organization.currentTeam.name}
            description={organization.currentTeam.membership
              ? `${membershipRoleLabel(organization.currentTeam.membership.role)} - ${membershipStatusLabel(organization.currentTeam.membership.status)}`
              : "Current team"}
          >
            <Badge tone={organization.currentTeam.status === "active" ? "success" : "warning"}>
              {organization.currentTeam.status === "suspended" ? "Billing repair" : "Active"}
            </Badge>
          </SettingsCardRow>
        ) : (
          <div className="space-y-4 p-4">
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-foreground">You are not in a team yet.</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Create a team to invite people, manage shared work, and use org billing.
              </p>
            </div>
            <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={handleCreateTeam}>
              <Input
                className="min-h-9 rounded-md border border-border-light bg-background px-3 text-sm"
                placeholder="Team name"
                value={organization.teamName}
                onChange={(event) => organization.setTeamName(event.currentTarget.value)}
              />
              <Input
                className="min-h-9 rounded-md border border-border-light bg-background px-3 text-sm"
                placeholder="Invite emails, comma separated"
                value={organization.inviteEmails}
                onChange={(event) => organization.setInviteEmails(event.currentTarget.value)}
              />
              <Button
                type="submit"
                size="sm"
                disabled={!organization.teamName.trim() || organization.creatingTeamCheckout}
              >
                Create team
              </Button>
            </form>
          </div>
        )}
      </SettingsCard>
      {organization.currentTeam ? (
        <CloudSecretsSettingsSurface
          scope={{
            kind: "organization",
            organizationId: organization.currentTeam.id,
            canManage: organization.currentTeam.membership?.status === "active"
              && (organization.currentTeam.membership.role === "owner"
                || organization.currentTeam.membership.role === "admin"),
          }}
        />
      ) : null}
    </section>
  );
}

function membershipRoleLabel(role: string): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "member":
      return "Member";
    default:
      return role;
  }
}

function membershipStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "removed":
      return "Removed";
    default:
      return status;
  }
}
