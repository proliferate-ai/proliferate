import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { useAuthActions } from "@/hooks/auth/workflows/use-auth-actions";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import {
  clearPendingOrganizationJoinTarget,
  readPendingOrganizationJoinTarget,
  writePendingOrganizationJoinTarget,
} from "@/lib/access/browser/organization-join-target";
import {
  type OrganizationInvitationRecord,
  type OrganizationMemberRecord,
  type OrganizationRole,
} from "@/lib/domain/organizations/organization-records";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useToastStore } from "@/stores/toast/toast-store";

const EMPTY_MEMBERS: OrganizationMemberRecord[] = [];
const EMPTY_INVITATIONS: OrganizationInvitationRecord[] = [];

export function OrganizationMembersPane() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const joinOrganizationId = useMemo(
    () => searchParams.get("joinOrganizationId"),
    [searchParams],
  );
  const [transientJoinOrganizationId, setTransientJoinOrganizationId] = useState(
    () => joinOrganizationId ?? readPendingOrganizationJoinTarget(),
  );
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
  const pendingInvitationsQuery = useCurrentUserOrganizationInvitations(
    authStatus === "authenticated",
  );
  const { signInWithGitHub } = useAuthActions();
  const { copyText } = useTauriShellActions();
  const showToast = useToastStore((state) => state.show);
  const signInStartedRef = useRef(false);
  const joinAttemptedRef = useRef(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const members = membersQuery.data?.members ?? EMPTY_MEMBERS;
  const invitations = invitationsQuery.data?.invitations ?? EMPTY_INVITATIONS;
  const pendingInvitations = pendingInvitationsQuery.data?.invitations ?? EMPTY_INVITATIONS;
  const canManage = admin.isAdmin;
  const canManageOwners = admin.isOwner;

  useEffect(() => {
    if (!joinOrganizationId) return;
    writePendingOrganizationJoinTarget(joinOrganizationId);
    joinAttemptedRef.current = false;
    setTransientJoinOrganizationId(joinOrganizationId);
    navigate(buildSettingsHref({ section: "organization-members" }), { replace: true });
  }, [joinOrganizationId, navigate]);

  useEffect(() => {
    if (
      !transientJoinOrganizationId
      || authStatus !== "authenticated"
      || joinAttemptedRef.current
    ) {
      return;
    }
    let cancelled = false;
    joinAttemptedRef.current = true;
    void actions.acceptInvitation(transientJoinOrganizationId)
      .then((response) => {
        if (cancelled) return;
        clearPendingOrganizationJoinTarget();
        setTransientJoinOrganizationId(null);
        setActiveOrganizationId(response.organization.id);
        setStatusMessage(`Joined ${response.organization.name}.`);
      })
      .catch(() => {
        if (cancelled) return;
        clearPendingOrganizationJoinTarget();
        setTransientJoinOrganizationId(null);
        setStatusMessage("Invitation could not be accepted.");
      });
    return () => {
      cancelled = true;
    };
  }, [
    actions.acceptInvitation,
    authStatus,
    setActiveOrganizationId,
    transientJoinOrganizationId,
  ]);

  useEffect(() => {
    if (
      !transientJoinOrganizationId
      || authStatus !== "anonymous"
      || signInStartedRef.current
    ) {
      return;
    }
    signInStartedRef.current = true;
    setStatusMessage("Opening sign-in to accept this invitation.");
    void signInWithGitHub()
      .catch(() => {
        setStatusMessage("Sign in could not start. Use Account settings to sign in, then reopen the invite link.");
      });
  }, [authStatus, signInWithGitHub, transientJoinOrganizationId]);

  async function handleInvite() {
    await actions.createInvitation({ email: inviteEmail, role: inviteRole });
    setInviteEmail("");
    setInviteRole("member");
  }

  async function handleAcceptCurrentInvitation(invitationId: string) {
    setStatusMessage(null);
    try {
      const response = await actions.acceptCurrentInvitation(invitationId);
      setActiveOrganizationId(response.organization.id);
      setStatusMessage(`Joined ${response.organization.name}.`);
    } catch {
      setStatusMessage("Invitation could not be accepted.");
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

  const unauthenticatedJoin = transientJoinOrganizationId && authStatus !== "authenticated";
  const shouldShowSignInState = authStatus !== "authenticated" && !unauthenticatedJoin;
  const shouldShowLoadingState = authStatus === "authenticated" && organizationsQuery.isLoading;
  const shouldShowErrorState = authStatus === "authenticated" && organizationsQuery.isError;
  const shouldShowEmptyState = authStatus === "authenticated"
    && organizationsQuery.isSuccess
    && organizations.length === 0
    && pendingInvitations.length === 0;
  const shouldShowPendingInvitations = authStatus === "authenticated"
    && pendingInvitations.length > 0;

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Members"
        description="Invite teammates, copy the organization join link, and manage access."
      />

      {statusMessage ? (
        <OrganizationNotice>{statusMessage}</OrganizationNotice>
      ) : null}

      {unauthenticatedJoin ? (
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
