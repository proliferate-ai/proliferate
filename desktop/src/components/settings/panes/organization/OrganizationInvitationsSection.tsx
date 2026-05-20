import { Badge } from "@/components/ui/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Select } from "@/components/ui/Select";
import { Mail, RefreshCw, Trash } from "@/components/ui/icons";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { OrganizationSection } from "@/components/settings/panes/organization/OrganizationLogo";
import {
  invitationStatusBadge,
  type OrganizationInvitationRecord,
} from "@/lib/domain/organizations/organization-records";

export function OrganizationInvitationsSection({
  invitations,
  canManage,
  inviteEmail,
  inviteRole,
  creatingInvitation,
  working,
  onInviteEmailChange,
  onInviteRoleChange,
  onInviteSubmit,
  onResend,
  onRevoke,
}: {
  invitations: OrganizationInvitationRecord[];
  canManage: boolean;
  inviteEmail: string;
  inviteRole: "admin" | "member";
  creatingInvitation: boolean;
  working: boolean;
  onInviteEmailChange: (value: string) => void;
  onInviteRoleChange: (value: "admin" | "member") => void;
  onInviteSubmit: () => Promise<void>;
  onResend: (invitationId: string) => void;
  onRevoke: (invitationId: string) => void;
}) {
  return (
    <OrganizationSection
      title="Invitations"
      description="Invite teammates and manage pending organization invites."
    >
      <SettingsCard>
        {canManage ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onInviteSubmit();
            }}
            className="flex flex-col gap-2 border-b border-border-light p-4 sm:flex-row"
          >
            <Input
              type="email"
              value={inviteEmail}
              onChange={(event) => onInviteEmailChange(event.currentTarget.value)}
              placeholder="name@company.com"
              aria-label="Invite email"
              className="min-w-0 flex-1"
            />
            <div className="w-full sm:w-32">
              <Select
                value={inviteRole}
                onChange={(event) => onInviteRoleChange(event.currentTarget.value as "admin" | "member")}
                aria-label="Invite role"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </Select>
            </div>
            <Button type="submit" disabled={!inviteEmail.trim()} loading={creatingInvitation}>
              <Mail className="size-4" />
              Invite
            </Button>
          </form>
        ) : null}
        {invitations.map((invitation) => (
          <InvitationRow
            key={invitation.id}
            invitation={invitation}
            canManage={canManage}
            working={working}
            onResend={() => onResend(invitation.id)}
            onRevoke={() => onRevoke(invitation.id)}
          />
        ))}
        {invitations.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No pending invitations.</div>
        ) : null}
      </SettingsCard>
    </OrganizationSection>
  );
}

function InvitationRow({
  invitation,
  canManage,
  working,
  onResend,
  onRevoke,
}: {
  invitation: OrganizationInvitationRecord;
  canManage: boolean;
  working: boolean;
  onResend: () => void;
  onRevoke: () => void;
}) {
  const status = invitationStatusBadge(invitation.status);

  return (
    <div className="flex flex-col gap-3 border-b border-border-light px-4 py-3 last:border-b-0 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{invitation.email}</div>
        <div className="truncate text-sm text-muted-foreground">
          {invitation.role} - {invitation.deliveryStatus}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <Badge tone={status.tone}>{status.label}</Badge>
        {canManage && invitation.status === "pending" ? (
          <>
            <Button type="button" variant="ghost" disabled={working} onClick={onResend}>
              <RefreshCw className="size-4" />
              Resend
            </Button>
            <Button type="button" variant="ghost" disabled={working} onClick={onRevoke}>
              <Trash className="size-4" />
              Revoke
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
