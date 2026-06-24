import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Select } from "@proliferate/ui/primitives/Select";
import { Link2, Mail } from "@proliferate/ui/icons";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { OrganizationSection } from "@/components/settings/panes/organization/OrganizationLogo";

export function OrganizationInvitationsSection({
  canManage,
  inviteEmail,
  inviteRole,
  creatingInvitation,
  copyingInviteLink,
  onInviteEmailChange,
  onInviteRoleChange,
  onInviteSubmit,
  onCopyInviteLink,
}: {
  canManage: boolean;
  inviteEmail: string;
  inviteRole: "admin" | "member";
  creatingInvitation: boolean;
  copyingInviteLink?: boolean;
  onInviteEmailChange: (value: string) => void;
  onInviteRoleChange: (value: "admin" | "member") => void;
  onInviteSubmit: () => Promise<void>;
  onCopyInviteLink?: () => void;
}) {
  if (!canManage) {
    return null;
  }

  return (
    <OrganizationSection
      title="Invite people"
      description="Send an email invitation or copy the shared organization join link."
    >
      <SettingsCard>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onInviteSubmit();
          }}
          className="flex flex-col gap-2 p-4 sm:flex-row"
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
          {onCopyInviteLink ? (
            <Button
              type="button"
              variant="secondary"
              loading={copyingInviteLink}
              onClick={onCopyInviteLink}
            >
              <Link2 className="size-4" />
              Copy link
            </Button>
          ) : null}
        </form>
      </SettingsCard>
    </OrganizationSection>
  );
}
