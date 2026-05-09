import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Trash } from "@/components/ui/icons";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import {
  Avatar,
  OrganizationSection,
} from "@/components/settings/panes/organization/OrganizationLogo";
import {
  membershipStatusBadge,
  type OrganizationMemberRecord,
  type OrganizationRole,
} from "@/lib/domain/organizations/organization-records";

export function OrganizationMembersSection({
  members,
  canManage,
  canManageOwners,
  currentUserId,
  updating,
  onRoleChange,
  onRemove,
}: {
  members: OrganizationMemberRecord[];
  canManage: boolean;
  canManageOwners: boolean;
  currentUserId: string | null;
  updating: boolean;
  onRoleChange: (membershipId: string, role: OrganizationRole) => void;
  onRemove: (membershipId: string) => void;
}) {
  return (
    <OrganizationSection title="Members">
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
        {members.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">No members yet.</div>
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

  return (
    <div className="flex items-center gap-3 p-3">
      <Avatar member={member} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {member.displayName || member.email}
        </div>
        <div className="truncate text-sm text-muted-foreground">{member.email}</div>
      </div>
      <Badge tone={status.tone}>{status.label}</Badge>
      <Select
        value={member.role}
        disabled={roleDisabled || updating}
        onChange={(event) => onRoleChange(event.currentTarget.value as OrganizationRole)}
        aria-label={`Role for ${member.email}`}
        className="w-28"
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
        <option value="owner" disabled={!canManageOwners}>Owner</option>
      </Select>
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
  );
}
