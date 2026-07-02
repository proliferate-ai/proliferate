import { useEffect, useRef, useState } from "react";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Button } from "@proliferate/ui/primitives/Button";
import { Check } from "@proliferate/ui/icons";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
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
    <SettingsSection
      title="Pending invitations"
      description="Join an organization that invited your signed-in email address."
    >
      {invitations.map((invitation) => (
        <SettingsRow
          key={invitation.id}
          label={invitation.organizationName ?? "Organization invitation"}
          description={`${invitation.role} access for ${invitation.email}`}
        >
          <Button
            type="button"
            variant="secondary"
            loading={accepting}
            onClick={() => setAcceptTarget(invitation)}
          >
            <Check className="size-4" />
            Accept invitation
          </Button>
        </SettingsRow>
      ))}
      <ConfirmationDialog
        open={acceptTarget !== null}
        title={acceptTarget ? `Join ${acceptTarget.organizationName ?? "organization"}?` : "Join organization?"}
        description={
          acceptTarget
            ? `Accept this invitation for ${acceptTarget.email} and join as ${acceptTarget.role}.`
            : "Accept this invitation and join the organization."
        }
        confirmLabel="Join"
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
    </SettingsSection>
  );
}
