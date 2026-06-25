import { useState, type ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { CurrentUserInvitationsSection } from "@/components/settings/panes/organization/CurrentUserInvitationsSection";
import { OrganizationInvitationsSection } from "@/components/settings/panes/organization/OrganizationInvitationsSection";
import { OrganizationMembersSection } from "@/components/settings/panes/organization/OrganizationMembersSection";
import { OrganizationSection } from "@/components/settings/panes/organization/OrganizationLogo";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { useCurrentUserOrganizationInvitations } from "@/hooks/access/cloud/organizations/use-current-user-organization-invitations";
import { useIsAdmin } from "@/hooks/access/cloud/organizations/use-is-admin";
import { useOrganizationActions } from "@/hooks/access/cloud/organizations/use-organization-actions";
import { useOrganizationInvitations } from "@/hooks/access/cloud/organizations/use-organization-invitations";
import { useOrganizationJoinLink } from "@/hooks/access/cloud/organizations/use-organization-join-link";
import { useOrganizationMembers } from "@/hooks/access/cloud/organizations/use-organization-members";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { useOrganizationJoinInvitationFlow } from "@/hooks/organizations/workflows/use-organization-join-invitation-flow";
import {
  type OrganizationInvitationRecord,
  type OrganizationMemberRecord,
  type OrganizationRole,
} from "@/lib/domain/organizations/organization-records";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useToastStore } from "@/stores/toast/toast-store";

const EMPTY_MEMBERS: OrganizationMemberRecord[] = [];
const EMPTY_INVITATIONS: OrganizationInvitationRecord[] = [];

export function OrganizationMembersPane() {
  const authStatus = useAuthStore((state) => state.status);
  const currentUser = useAuthStore((state) => state.user);
  const {
    activeOrganization,
    activeOrganizationId,
    organizations,
    organizationsQuery,
    setActiveOrganizationId,
  } = useActiveOrganization();
  const actions = useOrganizationActions(activeOrganizationId);
  const admin = useIsAdmin(activeOrganizationId);
  const membersQuery = useOrganizationMembers(activeOrganizationId);
  const invitationsQuery = useOrganizationInvitations(activeOrganizationId);
  const joinLinkQuery = useOrganizationJoinLink(activeOrganizationId, admin.isAdmin);
  const shouldLoadPendingInvitations = authStatus === "authenticated";
  const pendingInvitationsQuery = useCurrentUserOrganizationInvitations(
    shouldLoadPendingInvitations,
  );
  const { copyText } = useTauriShellActions();
  const showToast = useToastStore((state) => state.show);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const joinFlow = useOrganizationJoinInvitationFlow();

  const members = membersQuery.data?.members ?? EMPTY_MEMBERS;
  const invitations = invitationsQuery.data?.invitations ?? EMPTY_INVITATIONS;
  const pendingInvitations = pendingInvitationsQuery.data?.invitations ?? EMPTY_INVITATIONS;
  const canManage = admin.isAdmin;
  const canManageOwners = admin.isOwner;

  async function handleInvite() {
    await actions.createInvitation({ email: inviteEmail, role: inviteRole });
    setInviteEmail("");
    setInviteRole("member");
  }

  async function handleAcceptCurrentInvitation(invitationId: string) {
    joinFlow.setStatusMessage(null);
    try {
      const response = await actions.acceptCurrentInvitation(invitationId);
      setActiveOrganizationId(response.organization.id);
      joinFlow.clearJoinTarget();
      joinFlow.setStatusMessage(`Joined ${response.organization.name}.`);
      showToast(`Joined ${response.organization.name}.`, "info");
    } catch {
      joinFlow.setStatusMessage("Invitation could not be accepted.");
    }
  }

  async function handleCopyJoinLink() {
    try {
      let link = joinLinkQuery.data;
      if (!link) {
        link = (await joinLinkQuery.refetch()).data;
      }
      if (!link?.url) {
        throw new Error("Invite link could not be loaded.");
      }
      await copyText(link.url);
      showToast("Invite link copied.", "info");
    } catch {
      showToast("Invite link could not be copied.");
    }
  }

  function updateMemberRole(membershipId: string, role: OrganizationRole) {
    void actions.updateMembership({
      membershipId,
      input: { role },
    });
  }

  const shouldShowSignInState = authStatus !== "authenticated" && !joinFlow.unauthenticatedJoin;
  const shouldShowLoadingState = authStatus === "authenticated" && organizationsQuery.isLoading;
  const shouldShowErrorState = authStatus === "authenticated" && organizationsQuery.isError;
  const shouldShowEmptyState = authStatus === "authenticated"
    && organizationsQuery.isSuccess
    && organizations.length === 0
    && pendingInvitations.length === 0;
  const shouldShowPendingInvitations = pendingInvitations.length > 0;

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Members"
        description="Invite teammates, copy the organization join link, and manage access."
      />

      {joinFlow.statusMessage ? (
        <OrganizationNotice>{joinFlow.statusMessage}</OrganizationNotice>
      ) : null}

      {joinFlow.unauthenticatedJoin ? (
        <OrganizationNotice>Finish sign-in to accept this organization invitation.</OrganizationNotice>
      ) : null}

      {shouldShowSignInState ? (
        <OrganizationSection title="Members" description="Organization access is tied to your signed-in account.">
          <SettingsCard>
            <div className="p-4 text-sm text-muted-foreground">
              Sign in to view organization members.
            </div>
          </SettingsCard>
        </OrganizationSection>
      ) : null}

      {shouldShowLoadingState ? (
        <div className="text-sm text-muted-foreground">Loading members...</div>
      ) : null}

      {shouldShowErrorState ? (
        <OrganizationSection title="Members">
          <SettingsCard>
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                Organization members could not be loaded.
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void organizationsQuery.refetch();
                }}
              >
                Retry
              </Button>
            </div>
          </SettingsCard>
        </OrganizationSection>
      ) : null}

      {shouldShowPendingInvitations ? (
        <CurrentUserInvitationsSection
          invitations={pendingInvitations}
          accepting={actions.acceptingCurrentInvitation}
          focusedOrganizationId={joinFlow.joinOrganizationId}
          onAccept={(invitationId) => {
            void handleAcceptCurrentInvitation(invitationId);
          }}
        />
      ) : null}

      {shouldShowEmptyState ? (
        <OrganizationSection title="Members">
          <SettingsCard>
            <div className="p-4 text-sm text-muted-foreground">
              No organization yet.
            </div>
          </SettingsCard>
        </OrganizationSection>
      ) : null}

      {activeOrganization ? (
        <>
          <OrganizationMembersSection
            members={members}
            invitations={invitations}
            canManage={canManage}
            canManageOwners={canManageOwners}
            currentUserId={currentUser?.id ?? null}
            updating={actions.updatingMembership || actions.removingMembership || actions.revokingInvitation}
            onRoleChange={updateMemberRole}
            onRemove={(membershipId) => {
              void actions.removeMembership(membershipId);
            }}
            onRevokeInvitation={(invitationId) => {
              void actions.revokeInvitation(invitationId);
            }}
          />

          <OrganizationInvitationsSection
            canManage={canManage}
            inviteLinkUrl={joinLinkQuery.data?.url ?? null}
            inviteEmail={inviteEmail}
            inviteRole={inviteRole}
            creatingInvitation={actions.creatingInvitation}
            copyingInviteLink={joinLinkQuery.isFetching}
            onInviteEmailChange={setInviteEmail}
            onInviteRoleChange={setInviteRole}
            onInviteSubmit={handleInvite}
            onCopyInviteLink={() => {
              void handleCopyJoinLink();
            }}
          />
        </>
      ) : null}
    </section>
  );
}

function OrganizationNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border-light bg-foreground/5 px-4 py-3 text-sm text-muted-foreground">
      {children}
    </div>
  );
}
