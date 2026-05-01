import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { CloudUpload, Mail, RefreshCw, Trash } from "@/components/ui/icons";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import {
  Avatar,
  OrganizationLogo,
  OrganizationSection,
} from "@/components/settings/panes/organization/OrganizationLogo";
import { useActiveOrganization } from "@/hooks/organizations/use-active-organization";
import { useOrganizationActions } from "@/hooks/organizations/use-organization-actions";
import { useOrganizationInvitations } from "@/hooks/organizations/use-organization-invitations";
import { useOrganizationMembers } from "@/hooks/organizations/use-organization-members";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";
import type {
  OrganizationInvitationResponse,
  OrganizationMemberResponse,
  OrganizationResponse,
} from "@/lib/integrations/cloud/client";
import { useAuthStore } from "@/stores/auth/auth-store";

const EMPTY_MEMBERS: OrganizationMemberResponse[] = [];
const EMPTY_INVITATIONS: OrganizationInvitationResponse[] = [];
const ORGANIZATION_LOGO_IMAGE_MAX_BYTES = 256 * 1024;
const ORGANIZATION_LOGO_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MEMBERSHIP_STATUS_BADGES: Record<string, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  removed: { label: "Removed", tone: "destructive" },
};

const INVITATION_STATUS_BADGES: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: "Pending", tone: "warning" },
  accepted: { label: "Accepted", tone: "success" },
  revoked: { label: "Revoked", tone: "destructive" },
  expired: { label: "Expired", tone: "neutral" },
};

function organizationStatusBadge(
  value: string,
  map: Record<string, { label: string; tone: BadgeTone }>,
) {
  return map[value] ?? { label: value, tone: "neutral" as const };
}

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
    if (!ORGANIZATION_LOGO_IMAGE_TYPES.has(file.type)) {
      setLogoImageError("Use a PNG, JPEG, WebP, or GIF image.");
      return;
    }
    if (file.size > ORGANIZATION_LOGO_IMAGE_MAX_BYTES) {
      setLogoImageError("Use an image 256 KB or smaller.");
      return;
    }
    try {
      setSettingsLogoImage(await readLogoImage(file));
    } catch {
      setLogoImageError("Image could not be read.");
    }
  }

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    await actions.createInvitation({ email: inviteEmail, role: inviteRole });
    setInviteEmail("");
    setInviteRole("member");
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
        <div className="rounded-lg border border-border bg-card/50 px-3 py-2 text-sm text-muted-foreground">
          {statusMessage}
        </div>
      ) : null}

      {unauthenticatedHandoff ? (
        <div className="rounded-lg border border-border bg-card/50 px-3 py-2 text-sm text-muted-foreground">
          Sign in, then reopen the invitation email link to accept it.
        </div>
      ) : null}

      {organizations.length > 0 ? (
        <SettingsCard>
          <SettingsCardRow
            label="Active organization"
            description="This only changes the settings context."
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
            onLogoImageChange={(image) => setSettingsLogoImage(image)}
            onLogoImageFile={handleLogoImageFile}
            onSubmit={handleUpdateOrganization}
          />

          <OrganizationSection title="Members">
            <SettingsCard>
              {members.map((member) => (
                <MemberRow
                  key={member.membershipId}
                  member={member}
                  canManage={canManage}
                  canManageOwners={canManageOwners}
                  currentUserId={currentUser?.id ?? null}
                  updating={actions.updatingMembership || actions.removingMembership}
                  onRoleChange={(role) => {
                    void actions.updateMembership({
                      membershipId: member.membershipId,
                      input: { role },
                    });
                  }}
                  onRemove={() => {
                    void actions.removeMembership(member.membershipId);
                  }}
                />
              ))}
              {members.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">No members yet.</div>
              ) : null}
            </SettingsCard>
          </OrganizationSection>

          <OrganizationSection title="Invitations">
            <SettingsCard>
              {canManage ? (
                <form onSubmit={(event) => { void handleInvite(event); }} className="flex gap-2 p-3">
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.currentTarget.value)}
                    placeholder="name@company.com"
                    aria-label="Invite email"
                  />
                  <Select
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.currentTarget.value as "admin" | "member")}
                    aria-label="Invite role"
                    className="w-32"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </Select>
                  <Button type="submit" disabled={!inviteEmail.trim()} loading={actions.creatingInvitation}>
                    <Mail className="size-4" />
                    Invite
                  </Button>
                </form>
              ) : null}
              {invitations.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  canManage={canManage}
                  working={actions.resendingInvitation || actions.revokingInvitation}
                  onResend={() => { void actions.resendInvitation(invitation.id); }}
                  onRevoke={() => { void actions.revokeInvitation(invitation.id); }}
                />
              ))}
              {invitations.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">No pending invitations.</div>
              ) : null}
            </SettingsCard>
          </OrganizationSection>
        </>
      ) : null}
    </section>
  );
}

function OrganizationSettingsCard({
  organization,
  settingsName,
  settingsLogoImage,
  logoImageError,
  canManage,
  saving,
  onNameChange,
  onLogoImageChange,
  onLogoImageFile,
  onSubmit,
}: {
  organization: OrganizationResponse;
  settingsName: string;
  settingsLogoImage: string | null;
  logoImageError: string | null;
  canManage: boolean;
  saving: boolean;
  onNameChange: (value: string) => void;
  onLogoImageChange: (value: string | null) => void;
  onLogoImageFile: (file: File | null) => Promise<void>;
  onSubmit: (event: FormEvent) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    await onLogoImageFile(event.currentTarget.files?.[0] ?? null);
    event.currentTarget.value = "";
  }

  return (
    <OrganizationSection title="Organization Settings">
      <SettingsCard>
        <form onSubmit={(event) => { void onSubmit(event); }}>
          <SettingsCardRow
            label="Organization image"
            description="Defaults to the image we can infer from your email domain."
          >
            <div className="flex items-center gap-2">
              <OrganizationLogo organization={organization} logoImage={settingsLogoImage} />
              <Input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => { void handleFileChange(event); }}
              />
              {canManage ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <CloudUpload className="size-4" />
                    Upload
                  </Button>
                  {settingsLogoImage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        onLogoImageChange(null);
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </>
              ) : null}
            </div>
            {logoImageError ? (
              <div className="mt-2 text-xs text-destructive">{logoImageError}</div>
            ) : null}
          </SettingsCardRow>
          <SettingsCardRow
            label="Organization name"
            description="Shown in the organization switcher and settings."
          >
            <Input
              value={settingsName}
              onChange={(event) => onNameChange(event.currentTarget.value)}
              aria-label="Organization name"
              disabled={!canManage}
              className="w-64"
            />
          </SettingsCardRow>
          {canManage ? (
            <div className="flex justify-end p-3">
              <Button type="submit" loading={saving} disabled={!settingsName.trim()}>
                Save
              </Button>
            </div>
          ) : null}
        </form>
      </SettingsCard>
    </OrganizationSection>
  );
}

function MemberRow({
  member,
  canManage,
  canManageOwners,
  currentUserId,
  updating,
  onRoleChange,
  onRemove,
}: {
  member: OrganizationMemberResponse;
  canManage: boolean;
  canManageOwners: boolean;
  currentUserId: string | null;
  updating: boolean;
  onRoleChange: (role: "owner" | "admin" | "member") => void;
  onRemove: () => void;
}) {
  const isCurrentUser = member.userId === currentUserId;
  const roleDisabled = !canManage || isCurrentUser || (member.role === "owner" && !canManageOwners);
  const removeDisabled = !canManage || isCurrentUser;
  const status = organizationStatusBadge(member.status, MEMBERSHIP_STATUS_BADGES);
  return (
    <div className="flex items-center gap-3 p-3">
      <Avatar member={member} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {member.displayName || member.email}
        </div>
        <div className="truncate text-sm text-muted-foreground">{member.email}</div>
      </div>
      <Badge tone={status.tone}>{status.label}</Badge>
      <Select
        value={member.role}
        disabled={roleDisabled || updating}
        onChange={(event) => onRoleChange(event.currentTarget.value as "owner" | "admin" | "member")}
        aria-label={`Role for ${member.email}`}
        className="w-28"
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
        <option value="owner" disabled={!canManageOwners}>Owner</option>
      </Select>
      {canManage ? (
        <Button
          type="button"
          variant="ghost"
          disabled={removeDisabled || updating}
          onClick={onRemove}
          aria-label={`Remove ${member.email}`}
        >
          <Trash className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

function InvitationRow({
  invitation,
  canManage,
  working,
  onResend,
  onRevoke,
}: {
  invitation: OrganizationInvitationResponse;
  canManage: boolean;
  working: boolean;
  onResend: () => void;
  onRevoke: () => void;
}) {
  const status = organizationStatusBadge(invitation.status, INVITATION_STATUS_BADGES);
  return (
    <div className="flex items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{invitation.email}</div>
        <div className="truncate text-sm text-muted-foreground">
          {invitation.role} - {invitation.deliveryStatus}
        </div>
      </div>
      <Badge tone={status.tone}>{status.label}</Badge>
      {canManage && invitation.status === "pending" ? (
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" disabled={working} onClick={onResend}>
            <RefreshCw className="size-4" />
            Resend
          </Button>
          <Button type="button" variant="ghost" disabled={working} onClick={onRevoke}>
            <Trash className="size-4" />
            Revoke
          </Button>
        </div>
      ) : null}
    </div>
  );
}
