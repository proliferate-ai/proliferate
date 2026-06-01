import { useState, type FormEvent } from "react";

import {
  useCurrentTeam,
  useCurrentTeamCheckout,
  useTeamCheckoutActions,
} from "@proliferate/cloud-sdk-react";
import { SettingsCard } from "@proliferate/product-ui/settings/SettingsCard";
import { SettingsCardRow } from "@proliferate/product-ui/settings/SettingsCardRow";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";

import { SettingsActionButton } from "./SettingsActionButton";

export function OrganizationSettingsSection() {
  const currentTeam = useCurrentTeam();
  const checkout = useCurrentTeamCheckout();
  const checkoutActions = useTeamCheckoutActions();
  const [teamName, setTeamName] = useState("");
  const [inviteEmails, setInviteEmails] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  async function createTeam(event: FormEvent) {
    event.preventDefault();
    setActionError(null);
    try {
      const response = await checkoutActions.createTeamCheckout({
        teamName,
        inviteEmails: inviteEmails
          .split(",")
          .map((email) => email.trim())
          .filter(Boolean),
      });
      window.location.assign(response.url);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Team checkout could not start.");
    }
  }

  async function continueCheckout() {
    const url = checkout.data?.intent?.checkoutUrl;
    if (url) {
      window.location.assign(url);
    }
  }

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Organization"
        description="Create or join one team for shared work, members, invites, shared sandbox setup, and Team billing."
      />
      {actionError ? (
        <SettingsCard>
          <SettingsCardRow label="Action failed" description={actionError} />
        </SettingsCard>
      ) : null}
      {checkout.data?.intent && !currentTeam.data ? (
        <SettingsCard>
          <SettingsCardRow
            label={checkout.data.intent.teamName}
            description="Team checkout is pending. Continue checkout or cancel setup."
          >
            <div className="flex gap-2">
              <SettingsActionButton onClick={() => void continueCheckout()}>
                Continue
              </SettingsActionButton>
              <SettingsActionButton
                disabled={checkoutActions.cancelingTeamCheckout}
                onClick={() => void checkoutActions.cancelTeamCheckout(checkout.data!.intent!.id)}
              >
                Cancel
              </SettingsActionButton>
            </div>
          </SettingsCardRow>
        </SettingsCard>
      ) : null}
      <SettingsCard>
        {currentTeam.isLoading ? (
          <SettingsCardRow label="Organization" description="Loading team..." />
        ) : currentTeam.isError ? (
          <SettingsCardRow
            label="Organization"
            description="Team could not be loaded."
          >
            <SettingsActionButton onClick={() => void currentTeam.refetch()}>
              Retry
            </SettingsActionButton>
          </SettingsCardRow>
        ) : currentTeam.data ? (
          <SettingsCardRow
            label={currentTeam.data.name}
            description={currentTeam.data.membership
              ? `${membershipRoleLabel(currentTeam.data.membership.role)} - ${membershipStatusLabel(currentTeam.data.membership.status)}`
              : "Current team"}
          >
            <Badge tone={currentTeam.data.status === "active" ? "success" : "warning"}>
              {currentTeam.data.status === "suspended" ? "Billing repair" : "Active"}
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
            <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={createTeam}>
              <Input
                className="min-h-9 rounded-md border border-border-light bg-background px-3 text-sm"
                placeholder="Team name"
                value={teamName}
                onChange={(event) => setTeamName(event.currentTarget.value)}
              />
              <Input
                className="min-h-9 rounded-md border border-border-light bg-background px-3 text-sm"
                placeholder="Invite emails, comma separated"
                value={inviteEmails}
                onChange={(event) => setInviteEmails(event.currentTarget.value)}
              />
              <Button
                type="submit"
                size="sm"
                disabled={!teamName.trim() || checkoutActions.creatingTeamCheckout}
              >
                Create team
              </Button>
            </form>
          </div>
        )}
      </SettingsCard>
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
