import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Select } from "@proliferate/ui/primitives/Select";
import { Copy, Plus } from "@proliferate/ui/icons";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { OrganizationSection } from "@/components/settings/panes/organization/OrganizationLogo";

export function OrganizationInvitationsSection({
  canManage,
  inviteLinkUrl,
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
  inviteLinkUrl?: string | null;
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
    <div className="space-y-6">
      {onCopyInviteLink ? (
        <OrganizationSection
          title="Invite link"
          description="Share this link with people who already have an invitation for this organization."
        >
          <SettingsCard className="p-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={inviteLinkUrl ?? ""}
                readOnly
                placeholder={copyingInviteLink ? "Loading invite link..." : "Invite link unavailable"}
                aria-label="Organization invite link"
                className="min-w-0 flex-1 font-mono text-xs sm:text-sm"
              />
              <Button
                type="button"
                variant="secondary"
                loading={copyingInviteLink}
                onClick={onCopyInviteLink}
                disabled={!inviteLinkUrl && !copyingInviteLink}
              >
                <Copy className="size-4" />
                Copy link
              </Button>
            </div>
          </SettingsCard>
        </OrganizationSection>
      ) : null}

      <OrganizationSection
        title="Invite by email"
        description="Add an email address, choose a role, then send the same join link by email."
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
              placeholder="email@example.com"
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
            <Button
              type="submit"
              disabled={!inviteEmail.trim()}
              loading={creatingInvitation}
            >
              <Plus className="size-4" />
              Add
            </Button>
          </form>
        </SettingsCard>
      </OrganizationSection>
    </div>
  );
}
