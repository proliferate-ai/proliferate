import type { ReactNode } from "react";
import { Check, Copy, Mail, MoreHorizontal, Trash } from "@proliferate/ui/icons";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { SettingsEyebrow } from "@proliferate/product-ui/settings/SettingsEyebrow";
import { Avatar } from "@/components/settings/panes/organization/OrganizationLogo";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { buildProliferateApiUrl } from "@/lib/infra/proliferate-api";
import {
  membershipStatusBadge,
  type OrganizationInvitationRecord,
  type OrganizationMemberRecord,
  type OrganizationRole,
} from "@/lib/domain/organizations/organization-records";
import type { MemberListRow } from "@/lib/domain/organizations/member-list-rows";
import { useToastStore } from "@/stores/toast/toast-store";

const PEOPLE_GRID_CLASS =
  "grid grid-cols-[minmax(0,1fr)_6.75rem_5.25rem_8rem_2.25rem] items-center gap-x-3";

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
    <div className="w-full overflow-hidden">
      <div className="w-full">
        <SettingsEyebrow className={`${PEOPLE_GRID_CLASS} border-b border-border pb-3`}>
          <span>Name</span>
          <span>Date joined</span>
          <span>Role</span>
          <span>Authenticated with</span>
          <span aria-label="Actions" />
        </SettingsEyebrow>
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
          <EmptyPeopleRow label="No members match these filters." />
        ) : null}
        {!hasRows ? (
          <EmptyPeopleRow label="No members yet." />
        ) : null}
      </div>
    </div>
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
  const canChangeRole = canManage && !isCurrentUser && (member.role !== "owner" || canManageOwners);
  const removeDisabled = !canManage || isCurrentUser;
  const status = membershipStatusBadge(member.status);
  const showStatusBadge = status.label !== "Active";

  return (
    <div className={`${PEOPLE_GRID_CLASS} min-h-[5.25rem] border-b border-border py-5 last:border-b-0`}>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar member={member} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-ui font-medium leading-5 text-foreground" title={row.name}>
              {row.name}
            </span>
            {isCurrentUser ? <Badge tone="success">You</Badge> : null}
          </div>
          <div className="truncate text-ui-sm text-muted-foreground" title={row.email}>
            {row.email}
          </div>
        </div>
      </div>
      <MemberMeta value={row.dateLabel} />
      <MemberMeta value={roleLabel(member.role)} />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="truncate text-ui-sm text-foreground">{row.authLabel}</span>
        {showStatusBadge ? <Badge tone={status.tone}>{status.label}</Badge> : null}
      </div>
      <div className="flex justify-end">
        <RowActionMenu
          label={`Actions for ${member.email}`}
          disabled={!canManage}
        >
          {(close) => (
            <>
              <RoleMenuItems
                currentRole={member.role}
                disabled={!canChangeRole || updating}
                canManageOwners={canManageOwners}
                onSelect={(role) => {
                  onRoleChange(member.membershipId, role);
                  close();
                }}
              />
              <MenuSeparator />
              <PopoverMenuItem
                label="Remove"
                icon={<Trash className="size-4" />}
                disabled={removeDisabled || updating}
                onClick={() => {
                  onRemove(member.membershipId);
                  close();
                }}
              />
            </>
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
  const { copyText } = useTauriShellActions();
  const showToast = useToastStore((state) => state.show);

  async function handleCopyInviteLink() {
    const url = buildProliferateApiUrl(
      `/register?token=${invitation.id}&email=${encodeURIComponent(invitation.email)}`,
    );
    try {
      await copyText(url);
      showToast("Invite link copied.", "info");
    } catch {
      showToast("Invite link could not be copied.");
    }
  }

  return (
    <div className={`${PEOPLE_GRID_CLASS} min-h-[5.25rem] border-b border-border py-5 last:border-b-0`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-muted-foreground">
          <Mail className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-ui font-medium leading-5 text-foreground" title={row.name}>
            {row.name}
          </div>
          <div className="truncate text-ui-sm text-muted-foreground" title={row.email}>
            {row.email}
          </div>
        </div>
      </div>
      <MemberMeta value={row.dateLabel} />
      <MemberMeta value={roleLabel(invitation.role)} />
      <MemberMeta value={row.authLabel} />
      <div className="flex justify-end">
        <RowActionMenu
          label={`Actions for ${invitation.email}`}
          title="Invitation"
          disabled={!canManage || !onRevokeInvitation}
        >
          {(close) => (
<>
              <PopoverMenuItem
                label="Copy invite link"
                icon={<Copy className="size-4" />}
                onClick={() => {
                  void handleCopyInviteLink();
                  close();
                }}
              />
              <PopoverMenuItem
                label="Revoke invitation"
                icon={<Trash className="size-4" />}
                disabled={!onRevokeInvitation || updating}
                onClick={() => {
                  onRevokeInvitation?.(invitation.id);
                  close();
                }}
              />
            </>
          )}
        </RowActionMenu>
      </div>
    </div>
  );
}

function MemberMeta({ value }: { value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-ui-sm text-foreground">{value}</div>
    </div>
  );
}

function EmptyPeopleRow({ label }: { label: string }) {
  return (
    <div className="border-b border-border py-6 text-center text-ui-sm text-muted-foreground last:border-b-0">
      {label}
    </div>
  );
}

function RoleMenuItems({
  currentRole,
  disabled,
  canManageOwners,
  onSelect,
}: {
  currentRole: OrganizationRole;
  disabled: boolean;
  canManageOwners: boolean;
  onSelect: (role: OrganizationRole) => void;
}) {
  const roles: OrganizationRole[] = ["owner", "admin", "member"];
  return (
    <>
      {roles.map((role) => (
        <PopoverMenuItem
          key={role}
          label={`Make ${roleLabel(role).toLowerCase()}`}
          disabled={disabled || role === currentRole || (role === "owner" && !canManageOwners)}
          trailing={role === currentRole ? <Check className="size-3.5" /> : null}
          onClick={() => {
            onSelect(role);
          }}
        />
      ))}
    </>
  );
}

function RowActionMenu({
  label,
  title,
  disabled,
  children,
}: {
  label: string;
  title?: string;
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
      {(close) => (
        <>
          {title ? <MenuTitle>{title}</MenuTitle> : null}
          {children(close)}
        </>
      )}
    </PopoverButton>
  );
}

function MenuTitle({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pb-1.5 pt-2 text-ui-sm font-medium leading-4 text-muted-foreground">
      {children}
    </div>
  );
}

function MenuSeparator() {
  return <div className="my-1 h-px bg-border/60" />;
}

function roleLabel(role: string): string {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Member";
}
