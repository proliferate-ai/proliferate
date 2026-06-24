import { useState, type ReactNode } from "react";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { Select } from "@proliferate/ui/primitives/Select";
import {
  Mail,
  MoreHorizontal,
  Search,
  Trash,
} from "@proliferate/ui/icons";
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

type RoleFilter = "all" | OrganizationRole;
type StatusFilter = "all" | "active" | "invited";

interface MemberTableRow {
  key: string;
  kind: "member" | "invitation";
  name: string;
  email: string;
  role: string;
  dateLabel: string;
  authLabel: string;
  statusFilter: Exclude<StatusFilter, "all">;
  searchText: string;
  member?: OrganizationMemberRecord;
  invitation?: OrganizationInvitationRecord;
}

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
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const pendingInvitations = invitations.filter((invitation) => invitation.status === "pending");
  const rows = buildMemberRows(members, pendingInvitations);
  const visibleRows = rows.filter((row) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = query.length === 0 || row.searchText.includes(query);
    const matchesRole = roleFilter === "all" || row.role === roleFilter;
    const matchesStatus = statusFilter === "all" || row.statusFilter === statusFilter;
    return matchesSearch && matchesRole && matchesStatus;
  });
  const empty = rows.length === 0;

  return (
    <OrganizationSection
      title="People"
      description="Review active members and pending invitations for this organization."
    >
      <div className="space-y-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Search by name or email"
              aria-label="Search organization people"
              className="pl-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 lg:w-[22rem]">
            <Select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.currentTarget.value as RoleFilter)}
              aria-label="Filter by role"
            >
              <option value="all">All roles</option>
              <option value="owner">Owner</option>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
            </Select>
            <Select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.currentTarget.value as StatusFilter)}
              aria-label="Filter by status"
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="invited">Invited</option>
            </Select>
          </div>
        </div>

        <SettingsCard className="overflow-x-auto">
          <table className="min-w-[720px] table-fixed text-left text-sm">
            <thead>
              <tr className="border-b border-border-light text-xs font-medium uppercase tracking-normal text-muted-foreground">
                <th className="w-[38%] px-4 py-3">Name</th>
                <th className="w-[18%] px-4 py-3">Date joined</th>
                <th className="w-[16%] px-4 py-3">Role</th>
                <th className="w-[18%] px-4 py-3">Auth method</th>
                <th className="w-[10%] px-4 py-3 text-right" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => row.kind === "member" && row.member ? (
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
              {!empty && visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-sm text-muted-foreground">
                    No people match those filters.
                  </td>
                </tr>
              ) : null}
              {empty ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-sm text-muted-foreground">
                    No members yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </SettingsCard>
      </div>
    </OrganizationSection>
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
  row: MemberTableRow;
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

  return (
    <tr className="border-b border-border-light last:border-b-0 hover:bg-foreground/5">
      <th scope="row" className="px-4 py-3 font-normal">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar member={member} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-foreground" title={row.name}>
                {row.name}
              </span>
              {isCurrentUser ? <Badge tone="info">You</Badge> : null}
            </div>
            <div className="truncate text-muted-foreground" title={row.email}>
              {row.email}
            </div>
          </div>
        </div>
      </th>
      <td className="px-4 py-3 text-foreground">{row.dateLabel}</td>
      <td className="px-4 py-3">
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
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="text-foreground">{row.authLabel}</span>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </td>
      <td className="px-4 py-3">
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
      </td>
    </tr>
  );
}

function InvitationRow({
  row,
  invitation,
  canManage,
  updating,
  onRevokeInvitation,
}: {
  row: MemberTableRow;
  invitation: OrganizationInvitationRecord;
  canManage: boolean;
  updating: boolean;
  onRevokeInvitation?: (invitationId: string) => void;
}) {
  const status = invitationStatusBadge(invitation.status);

  return (
    <tr className="border-b border-border-light last:border-b-0 hover:bg-foreground/5">
      <th scope="row" className="px-4 py-3 font-normal">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-muted-foreground">
            <Mail className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground" title={row.name}>
              {row.name}
            </div>
            <div className="truncate text-muted-foreground" title={row.email}>
              {row.email}
            </div>
          </div>
        </div>
      </th>
      <td className="px-4 py-3 text-foreground">{row.dateLabel}</td>
      <td className="px-4 py-3 text-foreground">{roleLabel(invitation.role)}</td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="text-foreground">{row.authLabel}</span>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </td>
      <td className="px-4 py-3">
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
      </td>
    </tr>
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

function buildMemberRows(
  members: OrganizationMemberRecord[],
  pendingInvitations: OrganizationInvitationRecord[],
): MemberTableRow[] {
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
      authLabel: "Email invitation",
      statusFilter: "invited" as const,
      searchText: invitation.email.toLowerCase(),
      invitation,
    })),
  ];
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
