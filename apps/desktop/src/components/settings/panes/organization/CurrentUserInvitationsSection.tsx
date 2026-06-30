import { useEffect, useRef, useState } from "react";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Button } from "@proliferate/ui/primitives/Button";
import { Check } from "@proliferate/ui/icons";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { OrganizationSection } from "@/components/settings/panes/organization/OrganizationLogo";
import type { OrganizationInvitationRecord } from "@/lib/domain/organizations/organization-records";

export function CurrentUserInvitationsSection({
  invitations,
  accepting,
  focusedOrganizationId,
  onAccept,
}: {
  invitations: OrganizationInvitationRecord[];
  accepting: boolean;
  focusedOrganizationId?: string | null;
  onAccept: (invitationId: string) => void;
}) {
  const [acceptTarget, setAcceptTarget] = useState<OrganizationInvitationRecord | null>(null);
  const focusedPromptShownRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      !focusedOrganizationId
      || acceptTarget
      || focusedPromptShownRef.current === focusedOrganizationId
    ) {
      return;
    }
    const focusedInvitation = invitations.find(
      (invitation) => invitation.organizationId === focusedOrganizationId,
    );
    if (focusedInvitation) {
      focusedPromptShownRef.current = focusedOrganizationId;
      setAcceptTarget(focusedInvitation);
    }
  }, [acceptTarget, focusedOrganizationId, invitations]);

  if (invitations.length === 0) {
    return null;
  }

  return (
    <OrganizationSection
      title="Pending invitations"
      description="Join an organization that invited your signed-in email address."
    >
      <SettingsCard>
        {invitations.map((invitation) => (
          <div
            key={invitation.id}
            className="flex flex-col gap-3 border-b border-border-light px-4 py-3 last:border-b-0 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {invitation.organizationName ?? "Organization invitation"}
              </div>
              <div className="truncate text-sm text-muted-foreground">
                {invitation.role} access for {invitation.email}
              </div>
            </div>
            <div className="flex shrink-0 justify-end">
              <Button
                type="button"
                variant="secondary"
                loading={accepting}
                onClick={() => setAcceptTarget(invitation)}
              >
                <Check className="size-4" />
                Accept invitation
              </Button>
            </div>
          </div>
        ))}
      </SettingsCard>
      <ConfirmationDialog
        open={acceptTarget !== null}
        title={acceptTarget ? `Join ${acceptTarget.organizationName ?? "organization"}?` : "Join organization?"}
        description={
          acceptTarget
            ? `Accept this invitation for ${acceptTarget.email} and join as ${acceptTarget.role}.`
            : "Accept this invitation and join the organization."
        }
        confirmLabel="Accept invitation"
        loading={accepting}
        disableClose={accepting}
        onClose={() => setAcceptTarget(null)}
        onConfirm={() => {
          if (!acceptTarget) {
            return;
          }
          const invitationId = acceptTarget.id;
          setAcceptTarget(null);
          onAccept(invitationId);
        }}
      />
    </OrganizationSection>
  );
}
