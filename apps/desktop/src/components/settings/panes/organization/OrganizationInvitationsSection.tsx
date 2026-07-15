import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Copy, Plus } from "@proliferate/ui/icons";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { OrganizationSelectMenu } from "@/components/settings/panes/organization/OrganizationSelectMenu";

const INVITE_ROLE_OPTIONS = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
];

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
        <SettingsSection
          title="Invite link"
          description="Share this link with people who already have an invitation for this organization."
        >
          <div className="flex flex-col items-stretch gap-2 sm:flex-row">
            <div className="flex h-9 min-w-0 flex-1 items-center rounded-md border border-input bg-background px-3 text-ui text-foreground">
              <span className="min-w-0 truncate font-mono text-ui-sm">
                {inviteLinkUrl || (copyingInviteLink ? "Loading invite link…" : "Invite link unavailable")}
              </span>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="h-9 shrink-0"
              loading={copyingInviteLink}
              onClick={onCopyInviteLink}
              disabled={!inviteLinkUrl && !copyingInviteLink}
            >
              <Copy className="size-4" />
              Copy link
            </Button>
          </div>
        </SettingsSection>
      ) : null}

      <SettingsSection
        title="Invite by email"
        description="Send the join link to an email address with the selected role"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onInviteSubmit();
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <Input
            type="email"
            value={inviteEmail}
            onChange={(event) => onInviteEmailChange(event.currentTarget.value)}
            placeholder="email@example.com"
            aria-label="Invite email"
            className="min-w-0 flex-1 bg-background"
          />
          <div className="w-full sm:w-32">
            <OrganizationSelectMenu
              value={inviteRole}
              ariaLabel="Invite role"
              options={INVITE_ROLE_OPTIONS}
              onChange={(value) => onInviteRoleChange(value as "admin" | "member")}
            />
          </div>
          <Button
            type="submit"
            size="md"
            className="h-9 shrink-0"
            disabled={!inviteEmail.trim()}
            loading={creatingInvitation}
          >
            <Plus className="size-4" />
            Send invitation
          </Button>
        </form>
      </SettingsSection>
    </div>
  );
}
