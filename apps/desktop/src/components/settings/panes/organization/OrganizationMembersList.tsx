import type { ReactNode } from "react";
import { Mail, MoreHorizontal, Trash } from "@proliferate/ui/icons";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { Select } from "@proliferate/ui/primitives/Select";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { Avatar } from "@/components/settings/panes/organization/OrganizationLogo";
import {
  invitationStatusBadge,
  membershipStatusBadge,
  type OrganizationInvitationRecord,
  type OrganizationMemberRecord,
  type OrganizationRole,
} from "@/lib/domain/organizations/organization-records";

export interface MemberListRow {
  key: string;
  kind: "member" | "invitation";
  name: string;
  email: string;
  role: string;
  dateLabel: string;
  authLabel: string;
  statusFilter: "active" | "invited";
  searchText: string;
  member?: OrganizationMemberRecord;
  invitation?: OrganizationInvitationRecord;
}

export function OrganizationMembersList({
  rows,
  hasRows,
  canManage,
  canManageOwners,
  currentUserId,
  updating,
  onRoleChange,
  onRemove,
  onRevokeInvitation,
}: {
  rows: MemberListRow[];
  hasRows: boolean;
  canManage: boolean;
  canManageOwners: boolean;
  currentUserId: string | null;
  updating: boolean;
  onRoleChange: (membershipId: string, role: OrganizationRole) => void;
  onRemove: (membershipId: string) => void;
  onRevokeInvitation?: (invitationId: string) => void;
}) {
  return (
    <SettingsCard>
      <div className="divide-y divide-border-light">
        {rows.map((row) => row.kind === "member" && row.member ? (
          <MemberRow
            key={row.key}
            row={row}
            member={row.member}
            canManage={canManage}
            canManageOwners={canManageOwners}
            currentUserId={currentUserId}
            updating={updating}
            onRoleChange={onRoleChange}
            onRemove={onRemove}
          />
        ) : row.invitation ? (
          <InvitationRow
            key={row.key}
            row={row}
            invitation={row.invitation}
            canManage={canManage}
            updating={updating}
            onRevokeInvitation={onRevokeInvitation}
          />
        ) : null)}
        {hasRows && rows.length === 0 ? (
          <EmptyPeopleRow label="No people match those filters." />
        ) : null}
        {!hasRows ? (
          <EmptyPeopleRow label="No members yet." />
        ) : null}
      </div>
    </SettingsCard>
  );
}

function MemberRow({
  row,
  member,
  canManage,
  canManageOwners,
  currentUserId,
  updating,
  onRoleChange,
  onRemove,
}: {
  row: MemberListRow;
  member: OrganizationMemberRecord;
  canManage: boolean;
  canManageOwners: boolean;
  currentUserId: string | null;
  updating: boolean;
  onRoleChange: (membershipId: string, role: OrganizationRole) => void;
  onRemove: (membershipId: string) => void;
}) {
  const isCurrentUser = member.userId === currentUserId;
  const roleDisabled = !canManage || isCurrentUser || (member.role === "owner" && !canManageOwners);
  const removeDisabled = !canManage || isCurrentUser;
  const status = membershipStatusBadge(member.status);
  const showStatusBadge = status.label !== "Active";

  return (
    <div className="grid gap-3 px-4 py-3 hover:bg-foreground/5 lg:grid-cols-[minmax(0,1fr)_7rem_9rem_8rem_2.5rem] lg:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar member={member} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-foreground" title={row.name}>
              {row.name}
            </span>
            {isCurrentUser ? <Badge tone="info">You</Badge> : null}
          </div>
          <div className="truncate text-sm text-muted-foreground" title={row.email}>
            {row.email}
          </div>
        </div>
      </div>
      <MemberMeta label="Joined" value={row.dateLabel} />
      <div className="min-w-0">
        <div className="mb-1 text-xs text-muted-foreground lg:hidden">Role</div>
        <Select
          value={member.role}
          disabled={roleDisabled || updating}
          onChange={(event) => onRoleChange(member.membershipId, event.currentTarget.value as OrganizationRole)}
          aria-label={`Role for ${member.email}`}
          className="h-8"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
          <option value="owner" disabled={!canManageOwners}>Owner</option>
        </Select>
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground lg:hidden">Auth method</div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm text-foreground">{row.authLabel}</span>
          {showStatusBadge ? <Badge tone={status.tone}>{status.label}</Badge> : null}
        </div>
      </div>
      <div className="flex justify-end">
        <RowActionMenu
          label={`Actions for ${member.email}`}
          disabled={!canManage}
        >
          {(close) => (
            <PopoverMenuItem
              label="Remove"
              icon={<Trash className="size-3.5" />}
              disabled={removeDisabled || updating}
              onClick={() => {
                onRemove(member.membershipId);
                close();
              }}
            />
          )}
        </RowActionMenu>
      </div>
    </div>
  );
}

function InvitationRow({
  row,
  invitation,
  canManage,
  updating,
  onRevokeInvitation,
}: {
  row: MemberListRow;
  invitation: OrganizationInvitationRecord;
  canManage: boolean;
  updating: boolean;
  onRevokeInvitation?: (invitationId: string) => void;
}) {
  const status = invitationStatusBadge(invitation.status);

  return (
    <div className="grid gap-3 px-4 py-3 hover:bg-foreground/5 lg:grid-cols-[minmax(0,1fr)_7rem_9rem_8rem_2.5rem] lg:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-muted-foreground">
          <Mail className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground" title={row.name}>
            {row.name}
          </div>
          <div className="truncate text-sm text-muted-foreground" title={row.email}>
            {row.email}
          </div>
        </div>
      </div>
      <MemberMeta label="Joined" value={row.dateLabel} />
      <MemberMeta label="Role" value={roleLabel(invitation.role)} />
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground lg:hidden">Auth method</div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm text-foreground">{row.authLabel}</span>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </div>
      <div className="flex justify-end">
        <RowActionMenu
          label={`Actions for ${invitation.email}`}
          disabled={!canManage || !onRevokeInvitation}
        >
          {(close) => (
            <PopoverMenuItem
              label="Rescind invitation"
              icon={<Trash className="size-3.5" />}
              disabled={!onRevokeInvitation || updating}
              onClick={() => {
                onRevokeInvitation?.(invitation.id);
                close();
              }}
            />
          )}
        </RowActionMenu>
      </div>
    </div>
  );
}

export function buildMemberRows(
  members: OrganizationMemberRecord[],
  pendingInvitations: OrganizationInvitationRecord[],
): MemberListRow[] {
  return [
    ...members.map((member) => {
      const name = member.displayName || member.email;
      return {
        key: `member:${member.membershipId}`,
        kind: "member" as const,
        name,
        email: member.email,
        role: member.role,
        dateLabel: formatJoinedDate(member.joinedAt),
        authLabel: "GitHub",
        statusFilter: "active" as const,
        searchText: `${name} ${member.email}`.toLowerCase(),
        member,
      };
    }),
    ...pendingInvitations.map((invitation) => ({
      key: `invitation:${invitation.id}`,
      kind: "invitation" as const,
      name: invitation.email,
      email: invitation.email,
      role: invitation.role,
      dateLabel: "Invited",
      authLabel: "N/A",
      statusFilter: "invited" as const,
      searchText: invitation.email.toLowerCase(),
      invitation,
    })),
  ];
}

function MemberMeta({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground lg:hidden">{label}</div>
      <div className="truncate text-sm text-foreground">{value}</div>
    </div>
  );
}

function EmptyPeopleRow({ label }: { label: string }) {
  return (
    <div className="px-4 py-6 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function RowActionMenu({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled: boolean;
  children: (close: () => void) => ReactNode;
}) {
  return (
    <PopoverButton
      align="end"
      side="auto"
      trigger={(
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          disabled={disabled}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      )}
      className={`w-48 ${POPOVER_SURFACE_CLASS}`}
    >
      {children}
    </PopoverButton>
  );
}

function roleLabel(role: string): string {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Member";
}

function formatJoinedDate(value: string | null | undefined): string {
  if (!value) {
    return "Joined";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Joined";
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
