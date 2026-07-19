import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreditCard, Keyboard, LogOut, Settings } from "lucide-react";
import { Check, ChevronUpDown, Mail } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { OrganizationAvatar } from "#product/components/organizations/OrganizationAvatar";
import { SHORTCUTS } from "#product/config/shortcuts/registry";
import { useAppCapabilities } from "#product/hooks/capabilities/derived/use-app-capabilities";
import { useAppSidebarSignOutAction } from "#product/hooks/app/workflows/use-app-sidebar-sign-out-action";
import { useCloudBilling } from "#product/hooks/cloud/facade/use-cloud-billing";
import { useCurrentUserOrganizationInvitations } from "#product/hooks/access/cloud/organizations/use-current-user-organization-invitations";
import { useOrganizationActions } from "#product/hooks/access/cloud/organizations/use-organization-actions";
import { useJoinedOrganizationActivation } from "#product/hooks/organizations/workflows/use-joined-organization-activation";
import { useActiveOrganization } from "#product/hooks/organizations/facade/use-active-organization";
import { getShortcutDisplayLabel } from "#product/lib/domain/shortcuts/matching";
import type {
  OrganizationInvitationRecord,
  OrganizationRecord,
} from "#product/lib/domain/organizations/organization-records";
import {
  useProductAuthStatus,
  useProductAuthUser,
} from "#product/hooks/auth/facade/use-product-auth";
import { useKeyboardShortcutsDialogStore } from "#product/stores/shortcuts/keyboard-shortcuts-dialog-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import { OrganizationSwitchDialog } from "#product/components/app/sidebar/OrganizationSwitchDialog";
import { SidebarHelpFooter } from "#product/components/app/sidebar/SidebarHelpFooter";
import { SidebarUsageFooter } from "#product/components/app/sidebar/SidebarUsageFooter";

/**
 * Shared sidebar footer: a wide identity/account trigger plus independent
 * usage and help concerns. Organization behavior stays in the account surface.
 */
export function SidebarAccountFooter() {
  const navigate = useNavigate();
  const user = useProductAuthUser();
  const authStatus = useProductAuthStatus();
  const handleSignOut = useAppSidebarSignOutAction();
  const openShortcutsDialog = useKeyboardShortcutsDialogStore((state) => state.setOpen);
  const showToast = useToastStore((state) => state.show);
  const capabilities = useAppCapabilities();
  const { data: billingPlan } = useCloudBilling();
  const {
    activeOrganization,
    activeOrganizationId,
    organizations,
    organizationsQuery,
    setActiveOrganizationId,
  } = useActiveOrganization();
  const pendingInvitationsQuery = useCurrentUserOrganizationInvitations(
    authStatus === "authenticated",
  );
  const actions = useOrganizationActions(activeOrganizationId);
  const { activateJoinedOrganization, activatingJoinedOrganization } =
    useJoinedOrganizationActivation();
  const pendingInvitations = pendingInvitationsQuery.data?.invitations ?? [];
  const [acceptTarget, setAcceptTarget] = useState<OrganizationInvitationRecord | null>(null);
  const [switchTarget, setSwitchTarget] = useState<OrganizationRecord | null>(null);

  const displayName = user?.displayName?.trim() || user?.email || "Account";
  const initials = displayName.trim().slice(0, 2).toUpperCase() || "PR";
  const organizationName = activeOrganization?.name ?? null;
  // Vendor plan/credits only mean something where the server offers billing.
  const planLabel = capabilities.billingEnabled && billingPlan
    ? (billingPlan.isPaidCloud ? "Pro" : "Free")
    : null;
  const identityLabel = authStatus === "loading"
    ? "Loading account…"
    : authStatus === "authenticated"
      ? displayName
      : "Signed out";

  async function handleAcceptInvitation() {
    if (!acceptTarget) {
      return;
    }
    try {
      const response = await actions.acceptCurrentInvitation(acceptTarget.id);
      await activateJoinedOrganization(response.organization.id);
      setAcceptTarget(null);
      showToast(`Joined ${response.organization.name}.`, "info");
    } catch {
      showToast("Invitation could not be accepted.");
    }
  }

  return (
    <div className="shrink-0">
      <div aria-hidden className="mx-3 h-[0.5px] bg-sidebar-border" />
      <div className="flex items-center gap-1 px-2 py-2">
        <PopoverButton
          align="start"
          side="top"
          offset={8}
          trigger={(
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              aria-label="Open account menu"
              className="flex h-10 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 text-left text-sidebar-foreground hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent"
              title={displayName}
            >
              <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sidebar-accent text-ui-sm font-medium text-sidebar-foreground">
                {user?.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt=""
                    className="size-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  initials
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-ui">{displayName}</span>
                {organizationName ? (
                  <span className="truncate text-ui-sm text-faint">{organizationName}</span>
                ) : null}
              </span>
              <ChevronUpDown className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
            </Button>
          )}
          className={`w-72 ${POPOVER_SURFACE_CLASS}`}
        >
          {(close) => (
            <div className="max-h-[28rem] overflow-y-auto">
              <div className="px-2.5 py-2">
                <div className="truncate text-ui font-medium text-sidebar-foreground">
                  {identityLabel}
                </div>
                {authStatus === "authenticated" && user?.email && user.email !== displayName ? (
                  <div className="truncate text-ui-sm text-sidebar-muted-foreground">
                    {user.email}
                  </div>
                ) : null}
              </div>

              {authStatus === "authenticated" && pendingInvitations.length > 0 ? (
                <div className="py-1">
                  <div className="px-2 py-1 text-ui-sm text-muted-foreground">
                    Pending invitations
                  </div>
                  {pendingInvitations.map((invitation) => (
                    <PopoverMenuItem
                      key={invitation.id}
                      variant="sidebar"
                      label={invitation.organizationName ?? invitation.email}
                      icon={<Mail className="size-4" />}
                      trailing={<span className="font-[520]">Accept</span>}
                      trailingClassName="text-sidebar-muted-foreground group-hover/menu-item:text-sidebar-foreground group-focus/menu-item:text-sidebar-foreground"
                      onClick={() => {
                        setAcceptTarget(invitation);
                        close();
                      }}
                    />
                  ))}
                </div>
              ) : null}

              {authStatus === "authenticated" ? (
                <div className={`${pendingInvitations.length > 0 ? "border-t" : ""} border-border-light py-1`}>
                  {organizationsQuery.isLoading ? (
                    <div className="px-2 py-1.5 text-ui text-muted-foreground">
                      Loading organizations...
                    </div>
                  ) : organizationsQuery.isError ? (
                    <div className="px-2 py-1.5 text-ui text-muted-foreground">
                      Organizations could not be loaded.
                    </div>
                  ) : organizations.length > 0 ? (
                    organizations.map((organization) => (
                      <PopoverMenuItem
                        key={organization.id}
                        variant="sidebar"
                        label={organization.name}
                        icon={(
                          <OrganizationAvatar
                            name={organization.name}
                            logoImage={organization.logoImage}
                            className="size-5"
                          />
                        )}
                        iconClassName="text-current"
                        trailing={
                          organization.id === activeOrganizationId
                            ? <Check className="size-3.5" />
                            : undefined
                        }
                        onClick={() => {
                          // Org->org is semi-destructive (worker identity
                          // rotates), so it confirms first; gaining a first
                          // organization adopts it in place.
                          if (organization.id !== activeOrganizationId) {
                            if (activeOrganizationId) {
                              setSwitchTarget(organization);
                            } else {
                              setActiveOrganizationId(organization.id);
                            }
                          }
                          close();
                        }}
                      />
                    ))
                  ) : (
                    <div className="px-2 py-1.5 text-ui text-muted-foreground">
                      No organizations yet.
                    </div>
                  )}
                </div>
              ) : null}

              {authStatus === "authenticated" && planLabel ? (
                <div className="border-t border-border-light py-1">
                  <PopoverMenuItem
                    variant="sidebar"
                    label="Plan"
                    icon={<CreditCard className="size-4" />}
                    trailing={<span>{planLabel}</span>}
                    onClick={() => {
                      navigate("/settings?section=billing");
                      close();
                    }}
                  />
                </div>
              ) : null}

              <div className="border-t border-border-light py-1">
                <PopoverMenuItem
                  variant="sidebar"
                  label="Keyboard shortcuts"
                  icon={<Keyboard className="size-4" />}
                  trailing={<span>{getShortcutDisplayLabel(SHORTCUTS.showKeyboardShortcuts)}</span>}
                  onClick={() => {
                    close();
                    openShortcutsDialog(true);
                  }}
                />
                <PopoverMenuItem
                  variant="sidebar"
                  label="Settings"
                  icon={<Settings className="size-4" />}
                  trailing={<span>{getShortcutDisplayLabel(SHORTCUTS.openSettings)}</span>}
                  onClick={() => {
                    navigate("/settings?section=account");
                    close();
                  }}
                />
                {authStatus === "authenticated" ? (
                  <PopoverMenuItem
                    variant="sidebar"
                    label="Log out"
                    icon={<LogOut className="size-4" />}
                    onClick={() => {
                      handleSignOut();
                      close();
                    }}
                  />
                ) : null}
              </div>
            </div>
          )}
        </PopoverButton>
        <SidebarUsageFooter />
        <SidebarHelpFooter />
      </div>
      <ConfirmationDialog
        open={acceptTarget !== null}
        title={acceptTarget ? `Join ${acceptTarget.organizationName ?? "organization"}?` : "Join organization?"}
        description={
          acceptTarget
            ? `Accept this invitation for ${acceptTarget.email} and join as ${acceptTarget.role}.`
              + (activeOrganizationId ? " Joining switches your active organization and closes your running local sessions." : "")
            : "Accept this invitation and join the organization."
        }
        confirmLabel="Accept invitation"
        loading={actions.acceptingCurrentInvitation || activatingJoinedOrganization}
        disableClose={actions.acceptingCurrentInvitation || activatingJoinedOrganization}
        onClose={() => setAcceptTarget(null)}
        onConfirm={() => {
          void handleAcceptInvitation();
        }}
      />
      <OrganizationSwitchDialog
        target={switchTarget}
        onClose={() => setSwitchTarget(null)}
      />
    </div>
  );
}
