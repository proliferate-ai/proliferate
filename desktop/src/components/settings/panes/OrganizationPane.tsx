import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
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
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
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
    setActiveOrganizationId,
  } = useActiveOrganization();
  const actions = useOrganizationActions(activeOrganizationId);
  const membersQuery = useOrganizationMembers(activeOrganizationId);
  const invitationsQuery = useOrganizationInvitations(activeOrganizationId);
  const members = membersQuery.data?.members ?? EMPTY_MEMBERS;
  const invitations = invitationsQuery.data?.invitations ?? EMPTY_INVITATIONS;
  const currentUser = useAuthStore((state) => state.user);
  const currentMember = members.find((member) => member.userId === currentUser?.id) ?? null;
  const canManage = currentMember?.role === "owner" || currentMember?.role === "admin";
  const canManageOwners = currentMember?.role === "owner";
  const [settingsName, setSettingsName] = useState("");
  const [settingsLogoImage, setSettingsLogoImage] = useState<string | null>(null);
  const [logoImageError, setLogoImageError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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
        setActiveOrganizationId(response.organization.id);
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
    setActiveOrganizationId,
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
        <div className="rounded-lg border border-border bg-surface-elevated-secondary px-3 py-2 text-sm text-muted-foreground">
          {statusMessage}
        </div>
      ) : null}

      {unauthenticatedHandoff ? (
        <div className="rounded-lg border border-border bg-surface-elevated-secondary px-3 py-2 text-sm text-muted-foreground">
          Sign in, then reopen the invitation email link to accept it.
        </div>
      ) : null}

      {organizations.length > 0 ? (
        <SettingsCard>
          <SettingsCardRow
            label="Active organization"
            description="Choose which organization to view and manage here."
          >
            <Select
              value={activeOrganizationId ?? ""}
              onChange={(event) => setActiveOrganizationId(event.currentTarget.value || null)}
              aria-label="Active organization"
              className="min-w-48"
            >
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </Select>
          </SettingsCardRow>
        </SettingsCard>
      ) : null}

      {shouldShowSignInState ? (
        <OrganizationSection title="Membership">
          <SettingsCard>
            <div className="p-3 text-sm text-muted-foreground">
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
            <div className="flex items-center justify-between gap-3 p-3">
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
            <div className="p-3 text-sm text-muted-foreground">
              Organization setup is still being prepared for this account.
            </div>
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
