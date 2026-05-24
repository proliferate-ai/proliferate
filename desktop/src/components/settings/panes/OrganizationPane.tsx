import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import {
  cancelTeamCheckout,
  createTeamCheckoutSession,
  getCurrentTeamCheckout,
} from "@proliferate/cloud-sdk/client/billing";
import { OrganizationBillingLinkSection } from "@/components/settings/panes/organization/OrganizationBillingLinkSection";
import { OrganizationInvitationsSection } from "@/components/settings/panes/organization/OrganizationInvitationsSection";
import { OrganizationMembersSection } from "@/components/settings/panes/organization/OrganizationMembersSection";
import { OrganizationSettingsCard } from "@/components/settings/panes/organization/OrganizationSettingsCard";
import { OrganizationSection } from "@/components/settings/panes/organization/OrganizationLogo";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { useOrganizationActions } from "@/hooks/access/cloud/organizations/use-organization-actions";
import { useOrganizationInvitations } from "@/hooks/access/cloud/organizations/use-organization-invitations";
import { useOrganizationMembers } from "@/hooks/access/cloud/organizations/use-organization-members";
import { useIsAdmin } from "@/hooks/access/cloud/organizations/use-is-admin";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import {
  type OrganizationInvitationRecord,
  type OrganizationMemberRecord,
  type OrganizationRole,
} from "@/lib/domain/organizations/organization-records";
import { organizationLogoImageValidationError } from "@/lib/domain/organizations/logo-image";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";
import { useAuthStore } from "@/stores/auth/auth-store";

const EMPTY_MEMBERS: OrganizationMemberRecord[] = [];
const EMPTY_INVITATIONS: OrganizationInvitationRecord[] = [];
const CURRENT_TEAM_CHECKOUT_QUERY_KEY = ["cloud", "billing", "team-checkout", "current"] as const;

function readLogoImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Image could not be read."));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  });
}

export function OrganizationPane() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialInviteHandoff = useMemo(
    () => searchParams.get("inviteHandoff"),
    [searchParams],
  );
  const [transientInviteHandoff] = useState(initialInviteHandoff);
  const authStatus = useAuthStore((state) => state.status);
  const {
    activeOrganization,
    activeOrganizationId,
    organizations,
    organizationsQuery,
  } = useActiveOrganization();
  const { openExternal } = useTauriShellActions();
  const queryClient = useQueryClient();
  const actions = useOrganizationActions(activeOrganizationId);
  const membersQuery = useOrganizationMembers(activeOrganizationId);
  const admin = useIsAdmin(activeOrganizationId);
  const invitationsQuery = useOrganizationInvitations(activeOrganizationId);
  const members = membersQuery.data?.members ?? EMPTY_MEMBERS;
  const invitations = invitationsQuery.data?.invitations ?? EMPTY_INVITATIONS;
  const currentUser = useAuthStore((state) => state.user);
  const canManage = admin.isAdmin;
  const canManageOwners = admin.isOwner;
  const [settingsName, setSettingsName] = useState("");
  const [settingsLogoImage, setSettingsLogoImage] = useState<string | null>(null);
  const [logoImageError, setLogoImageError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [newTeamName, setNewTeamName] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const teamCheckoutQuery = useQuery({
    queryKey: CURRENT_TEAM_CHECKOUT_QUERY_KEY,
    queryFn: () => getCurrentTeamCheckout(),
    enabled: authStatus === "authenticated",
  });
  const createTeamCheckoutMutation = useMutation({
    mutationFn: (teamName: string) => createTeamCheckoutSession({
      teamName,
      inviteEmails: [],
    }),
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: CURRENT_TEAM_CHECKOUT_QUERY_KEY });
      await openExternal(response.url);
    },
  });
  const cancelTeamCheckoutMutation = useMutation({
    mutationFn: (intentId: string) => cancelTeamCheckout(intentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CURRENT_TEAM_CHECKOUT_QUERY_KEY });
    },
  });

  useEffect(() => {
    if (!initialInviteHandoff) return;
    navigate(buildSettingsHref({ section: "organization" }), { replace: true });
  }, [initialInviteHandoff, navigate]);

  useEffect(() => {
    if (!transientInviteHandoff || authStatus !== "authenticated") {
      return;
    }
    let cancelled = false;
    void actions.acceptInvitation(transientInviteHandoff)
      .then((response) => {
        if (cancelled) return;
        setStatusMessage(`Joined ${response.organization.name}.`);
      })
      .catch(() => {
        if (cancelled) return;
        setStatusMessage("Invitation could not be accepted. Reopen the email link to try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [
    actions.acceptInvitation,
    authStatus,
    transientInviteHandoff,
  ]);

  useEffect(() => {
    setSettingsName(activeOrganization?.name ?? "");
    setSettingsLogoImage(activeOrganization?.logoImage ?? null);
    setLogoImageError(null);
  }, [activeOrganization?.id, activeOrganization?.logoImage, activeOrganization?.name]);

  async function handleUpdateOrganization(event: FormEvent) {
    event.preventDefault();
    await actions.updateOrganization({
      name: settingsName,
      logoImage: settingsLogoImage,
    });
  }

  async function handleLogoImageFile(file: File | null) {
    setLogoImageError(null);
    if (!file) {
      return;
    }
    const validationError = organizationLogoImageValidationError(file);
    if (validationError) {
      setLogoImageError(validationError);
      return;
    }
    try {
      setSettingsLogoImage(await readLogoImage(file));
    } catch {
      setLogoImageError("Image could not be read.");
    }
  }

  async function handleInvite() {
    await actions.createInvitation({ email: inviteEmail, role: inviteRole });
    setInviteEmail("");
    setInviteRole("member");
  }

  async function handleCreateTeamCheckout(event: FormEvent) {
    event.preventDefault();
    setStatusMessage(null);
    await createTeamCheckoutMutation.mutateAsync(newTeamName.trim());
  }

  async function handleContinueTeamCheckout(url: string) {
    await openExternal(url);
  }

  function updateMemberRole(membershipId: string, role: OrganizationRole) {
    void actions.updateMembership({
      membershipId,
      input: { role },
    });
  }

  const unauthenticatedHandoff = transientInviteHandoff && authStatus !== "authenticated";
  const shouldShowSignInState = authStatus !== "authenticated" && !unauthenticatedHandoff;
  const shouldShowLoadingState = authStatus === "authenticated" && organizationsQuery.isLoading;
  const shouldShowErrorState = authStatus === "authenticated" && organizationsQuery.isError;
  const shouldShowEmptyState = authStatus === "authenticated"
    && organizationsQuery.isSuccess
    && organizations.length === 0;

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Organization"
        description="Team membership, invitations, and organization settings."
      />

      {statusMessage ? (
        <OrganizationNotice>{statusMessage}</OrganizationNotice>
      ) : null}

      {unauthenticatedHandoff ? (
        <OrganizationNotice>Sign in, then reopen the invitation email link to accept it.</OrganizationNotice>
      ) : null}

      {shouldShowSignInState ? (
        <OrganizationSection title="Membership" description="Organization access is tied to your signed-in account.">
          <SettingsCard>
            <div className="p-4 text-sm text-muted-foreground">
              Sign in to view your organization.
            </div>
          </SettingsCard>
        </OrganizationSection>
      ) : null}

      {shouldShowLoadingState ? (
        <div className="text-sm text-muted-foreground">Loading organizations...</div>
      ) : null}

      {shouldShowErrorState ? (
        <OrganizationSection title="Membership">
          <SettingsCard>
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                Organization settings could not be loaded.
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

      {shouldShowEmptyState ? (
        <OrganizationSection title="Membership">
          <SettingsCard>
            {teamCheckoutQuery.data?.intent?.checkoutUrl ? (
              <SettingsCardRow
                label={teamCheckoutQuery.data.intent.teamName}
                description="Team checkout is pending. Continue checkout or cancel setup."
              >
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      void handleContinueTeamCheckout(teamCheckoutQuery.data!.intent!.checkoutUrl!);
                    }}
                  >
                    Continue checkout
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    loading={cancelTeamCheckoutMutation.isPending}
                    onClick={() => {
                      void cancelTeamCheckoutMutation.mutateAsync(teamCheckoutQuery.data!.intent!.id);
                    }}
                  >
                    Cancel setup
                  </Button>
                </div>
              </SettingsCardRow>
            ) : (
              <form onSubmit={(event) => { void handleCreateTeamCheckout(event); }}>
                <SettingsCardRow
                  label="Create a Team"
                  description="Start Team checkout to unlock members, shared cloud work, org billing, Slack work, and shared sandbox setup."
                >
                  <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row sm:justify-end">
                    <Input
                      value={newTeamName}
                      onChange={(event) => setNewTeamName(event.currentTarget.value)}
                      placeholder="Team name"
                      aria-label="Team name"
                    />
                    <Button
                      type="submit"
                      loading={createTeamCheckoutMutation.isPending}
                      disabled={!newTeamName.trim()}
                    >
                      Create Team
                    </Button>
                  </div>
                </SettingsCardRow>
                {createTeamCheckoutMutation.error ? (
                  <div className="border-t border-border-light p-4 text-sm text-destructive">
                    {createTeamCheckoutMutation.error instanceof Error
                      ? createTeamCheckoutMutation.error.message
                      : "Team checkout could not start."}
                  </div>
                ) : null}
              </form>
            )}
          </SettingsCard>
        </OrganizationSection>
      ) : null}

      {activeOrganization ? (
        <>
          <OrganizationSettingsCard
            organization={activeOrganization}
            settingsName={settingsName}
            settingsLogoImage={settingsLogoImage}
            logoImageError={logoImageError}
            canManage={canManage}
            saving={actions.updatingOrganization}
            onNameChange={setSettingsName}
            onLogoImageChange={setSettingsLogoImage}
            onLogoImageFile={handleLogoImageFile}
            onSubmit={handleUpdateOrganization}
          />

          <OrganizationBillingLinkSection />

          <OrganizationMembersSection
            members={members}
            canManage={canManage}
            canManageOwners={canManageOwners}
            currentUserId={currentUser?.id ?? null}
            updating={actions.updatingMembership || actions.removingMembership}
            onRoleChange={updateMemberRole}
            onRemove={(membershipId) => {
              void actions.removeMembership(membershipId);
            }}
          />

          <OrganizationInvitationsSection
            invitations={invitations}
            canManage={canManage}
            inviteEmail={inviteEmail}
            inviteRole={inviteRole}
            creatingInvitation={actions.creatingInvitation}
            working={actions.resendingInvitation || actions.revokingInvitation}
            onInviteEmailChange={setInviteEmail}
            onInviteRoleChange={setInviteRole}
            onInviteSubmit={handleInvite}
            onResend={(invitationId) => {
              void actions.resendInvitation(invitationId);
            }}
            onRevoke={(invitationId) => {
              void actions.revokeInvitation(invitationId);
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
