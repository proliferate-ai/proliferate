import { useState } from "react";
import { Search } from "@proliferate/ui/icons";
import { Input } from "@proliferate/ui/primitives/Input";
import { OrganizationSection } from "@/components/settings/panes/organization/OrganizationLogo";
import { OrganizationMembersList } from "@/components/settings/panes/organization/OrganizationMembersList";
import { OrganizationSelectMenu } from "@/components/settings/panes/organization/OrganizationSelectMenu";
import { buildMemberRows } from "@/lib/domain/organizations/member-list-rows";
import type {
  OrganizationInvitationRecord,
  OrganizationMemberRecord,
  OrganizationRole,
} from "@/lib/domain/organizations/organization-records";

type RoleFilter = "all" | OrganizationRole;
type StatusFilter = "all" | "active" | "invited";

const ROLE_FILTER_OPTIONS = [
  { value: "all", label: "All roles" },
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
];

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All status" },
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
];

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
            <OrganizationSelectMenu
              value={roleFilter}
              ariaLabel="Filter by role"
              options={ROLE_FILTER_OPTIONS}
              onChange={(value) => setRoleFilter(value as RoleFilter)}
            />
            <OrganizationSelectMenu
              value={statusFilter}
              ariaLabel="Filter by status"
              options={STATUS_FILTER_OPTIONS}
              onChange={(value) => setStatusFilter(value as StatusFilter)}
            />
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
