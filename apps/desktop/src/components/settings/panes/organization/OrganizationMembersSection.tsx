import { useState } from "react";
import { Search } from "@proliferate/ui/icons";
import { Input } from "@proliferate/ui/primitives/Input";
import { Select } from "@proliferate/ui/primitives/Select";
import { OrganizationSection } from "@/components/settings/panes/organization/OrganizationLogo";
import {
  OrganizationMembersList,
  buildMemberRows,
} from "@/components/settings/panes/organization/OrganizationMembersList";
import type {
  OrganizationInvitationRecord,
  OrganizationMemberRecord,
  OrganizationRole,
} from "@/lib/domain/organizations/organization-records";

type RoleFilter = "all" | OrganizationRole;
type StatusFilter = "all" | "active" | "invited";

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

        <OrganizationMembersList
          rows={visibleRows}
          hasRows={rows.length > 0}
          canManage={canManage}
          canManageOwners={canManageOwners}
          currentUserId={currentUserId}
          updating={updating}
          onRoleChange={onRoleChange}
          onRemove={onRemove}
          onRevokeInvitation={onRevokeInvitation}
        />
      </div>
    </OrganizationSection>
  );
}
