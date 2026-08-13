import { Button } from "#product/primitives/Button";
import { Input } from "#product/primitives/Input";
import { Copy, Plus } from "#product/primitives/icons/core";
import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";
import { OrganizationSelectMenu } from "#product/components/settings/panes/organization/OrganizationSelectMenu";

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
          {/* Not a SettingsRow (spec §4.1 named this row for it): SettingsRow is
              label-left / control-right, and this is a full-bleed control strip —
              a flex-1 Input that must span the card's whole width with the copy
              button after it. px-3.5 py-[13px] is SettingsRow's own in-card
              geometry, transcribed so this strip lines up with the SettingsRows
              in sibling cards; it is not a second row shape. */}
          <div className="flex flex-col items-stretch gap-2 px-3.5 py-[13px] sm:flex-row">
            <Input
              readOnly
              value={inviteLinkUrl ?? ""}
              placeholder={copyingInviteLink ? "Loading invite link…" : "Invite link unavailable"}
              aria-label="Invite link"
              className="min-w-0 flex-1 bg-background font-mono text-ui-sm"
            />
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="h-9 shrink-0"
              loading={copyingInviteLink}
              onClick={onCopyInviteLink}
              disabled={!inviteLinkUrl && !copyingInviteLink}
            >
              <Copy className="icon-paired" />
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
          // Same as the invite-link strip above: a full-bleed <form> of three
          // side-by-side controls, not SettingsRow's label/control split.
          // px-3.5 py-[13px] transcribes SettingsRow's in-card geometry so the
          // strip aligns with real SettingsRows in sibling cards.
          className="flex flex-col gap-2 px-3.5 py-[13px] sm:flex-row"
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
            <Plus className="icon-paired" />
            Send invitation
          </Button>
        </form>
      </SettingsSection>
    </div>
  );
}
