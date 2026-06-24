import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Select } from "@proliferate/ui/primitives/Select";
import { Mail, Trash } from "@proliferate/ui/icons";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import {
  Avatar,
  OrganizationSection,
} from "@/components/settings/panes/organization/OrganizationLogo";
import {
  invitationStatusBadge,
  membershipStatusBadge,
  type OrganizationInvitationRecord,
  type OrganizationMemberRecord,
  type OrganizationRole,
} from "@/lib/domain/organizations/organization-records";

export function OrganizationMembersSection({
  members,
  invitations = [],
  canManage,
  canManageOwners,
  currentUserId,
  updating,
  onRoleChange,
  onRemove,
  onRevokeInvitation,
}: {
  members: OrganizationMemberRecord[];
  invitations?: OrganizationInvitationRecord[];
  canManage: boolean;
  canManageOwners: boolean;
  currentUserId: string | null;
  updating: boolean;
  onRoleChange: (membershipId: string, role: OrganizationRole) => void;
  onRemove: (membershipId: string) => void;
  onRevokeInvitation?: (invitationId: string) => void;
}) {
  const pendingInvitations = invitations.filter((invitation) => invitation.status === "pending");
  const empty = members.length === 0 && pendingInvitations.length === 0;

  return (
    <OrganizationSection
      title="Members"
      description="Review active members and pending invitations for this organization."
    >
      <SettingsCard>
        {members.map((member) => (
          <MemberRow
            key={member.membershipId}
            member={member}
            canManage={canManage}
            canManageOwners={canManageOwners}
            currentUserId={currentUserId}
            updating={updating}
            onRoleChange={(role) => onRoleChange(member.membershipId, role)}
            onRemove={() => onRemove(member.membershipId)}
          />
        ))}
        {pendingInvitations.map((invitation) => (
          <InvitationMemberRow
            key={invitation.id}
            invitation={invitation}
            canManage={canManage}
            updating={updating}
            onRevoke={() => onRevokeInvitation?.(invitation.id)}
          />
        ))}
        {empty ? (
          <div className="p-4 text-sm text-muted-foreground">No members yet.</div>
        ) : null}
      </SettingsCard>
    </OrganizationSection>
  );
}

function MemberRow({
  member,
  canManage,
  canManageOwners,
  currentUserId,
  updating,
  onRoleChange,
  onRemove,
}: {
  member: OrganizationMemberRecord;
  canManage: boolean;
  canManageOwners: boolean;
  currentUserId: string | null;
  updating: boolean;
  onRoleChange: (role: OrganizationRole) => void;
  onRemove: () => void;
}) {
  const isCurrentUser = member.userId === currentUserId;
  const roleDisabled = !canManage || isCurrentUser || (member.role === "owner" && !canManageOwners);
  const removeDisabled = !canManage || isCurrentUser;
  const status = membershipStatusBadge(member.status);
  const joinedLabel = formatJoinedDate(member.joinedAt);

  return (
    <div className="flex flex-col gap-3 border-b border-border-light px-4 py-3 last:border-b-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar member={member} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {member.displayName || member.email}
          </div>
          <div className="truncate text-sm text-muted-foreground">
            {member.email} · {joinedLabel} · Product account
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <Badge tone={status.tone}>{status.label}</Badge>
        <div className="w-28">
          <Select
            value={member.role}
            disabled={roleDisabled || updating}
            onChange={(event) => onRoleChange(event.currentTarget.value as OrganizationRole)}
            aria-label={`Role for ${member.email}`}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="owner" disabled={!canManageOwners}>Owner</option>
          </Select>
        </div>
        {canManage ? (
          <Button
            type="button"
            variant="ghost"
            disabled={removeDisabled || updating}
            onClick={onRemove}
            aria-label={`Remove ${member.email}`}
          >
            <Trash className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function InvitationMemberRow({
  invitation,
  canManage,
  updating,
  onRevoke,
}: {
  invitation: OrganizationInvitationRecord;
  canManage: boolean;
  updating: boolean;
  onRevoke: () => void;
}) {
  const status = invitationStatusBadge(invitation.status);

  return (
    <div className="flex flex-col gap-3 border-b border-border-light px-4 py-3 last:border-b-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/10 text-muted-foreground">
          <Mail className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {invitation.email}
          </div>
          <div className="truncate text-sm text-muted-foreground">
            Invited · Email invitation
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <Badge tone={status.tone}>{status.label}</Badge>
        <div className="w-28">
          <Select
            value={invitation.role}
            disabled
            aria-label={`Role for ${invitation.email}`}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </Select>
        </div>
        {canManage ? (
          <Button
            type="button"
            variant="ghost"
            disabled={updating}
            onClick={onRevoke}
            aria-label={`Rescind invitation for ${invitation.email}`}
          >
            <Trash className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function formatJoinedDate(value: string | null | undefined): string {
  if (!value) {
    return "Joined";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Joined";
  }
  return `Joined ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}
