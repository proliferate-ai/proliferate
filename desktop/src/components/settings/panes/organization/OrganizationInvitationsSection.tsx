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
    <OrganizationSection title="Invitations">
      <SettingsCard>
        {canManage ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onInviteSubmit();
            }}
            className="flex gap-2 p-3"
          >
            <Input
              type="email"
              value={inviteEmail}
              onChange={(event) => onInviteEmailChange(event.currentTarget.value)}
              placeholder="name@company.com"
              aria-label="Invite email"
            />
            <Select
              value={inviteRole}
              onChange={(event) => onInviteRoleChange(event.currentTarget.value as "admin" | "member")}
              aria-label="Invite role"
              className="w-32"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
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
          <div className="p-3 text-sm text-muted-foreground">No pending invitations.</div>
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
    <div className="flex items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{invitation.email}</div>
        <div className="truncate text-sm text-muted-foreground">
          {invitation.role} - {invitation.deliveryStatus}
        </div>
      </div>
      <Badge tone={status.tone}>{status.label}</Badge>
      {canManage && invitation.status === "pending" ? (
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" disabled={working} onClick={onResend}>
            <RefreshCw className="size-4" />
            Resend
          </Button>
          <Button type="button" variant="ghost" disabled={working} onClick={onRevoke}>
            <Trash className="size-4" />
            Revoke
          </Button>
        </div>
      ) : null}
    </div>
  );
}
