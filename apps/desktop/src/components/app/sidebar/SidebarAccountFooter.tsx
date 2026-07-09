import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookMarked,
  BookOpen,
  CreditCard,
  Globe,
  Keyboard,
  Lightbulb,
  LogOut,
  MessageSquare,
  Settings,
} from "lucide-react";
import {
  ArrowUpRight,
  Check,
  ChevronUpDown,
  Discord,
  Mail,
} from "@proliferate/ui/icons";
import { useUsageSummary } from "@proliferate/cloud-sdk-react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { OrganizationAvatar } from "@/components/organizations/OrganizationAvatar";
import { PROLIFERATE_DOCS_URL } from "@/config/capabilities";
import { SHORTCUTS } from "@/config/shortcuts/registry";
import { useAppSidebarSignOutAction } from "@/hooks/app/workflows/use-app-sidebar-sign-out-action";
import { useAppVersion } from "@/hooks/access/tauri/app/use-app-version";
import { useCloudBilling } from "@/hooks/cloud/facade/use-cloud-billing";
import { useCurrentUserOrganizationInvitations } from "@/hooks/access/cloud/organizations/use-current-user-organization-invitations";
import { useOrganizationActions } from "@/hooks/access/cloud/organizations/use-organization-actions";
import { useJoinedOrganizationActivation } from "@/hooks/organizations/workflows/use-joined-organization-activation";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { useOpenSupportReportWindow } from "@/hooks/support/workflows/use-open-support-report-window";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { getProliferateWebBaseUrl } from "@/lib/infra/proliferate-web";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";
import type {
  OrganizationInvitationRecord,
  OrganizationRecord,
} from "@/lib/domain/organizations/organization-records";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useKeyboardShortcutsDialogStore } from "@/stores/shortcuts/keyboard-shortcuts-dialog-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { OrganizationSwitchDialog } from "./OrganizationSwitchDialog";
import { ConsumptionCard } from "./SidebarConsumptionCard";

const PROLIFERATE_CHANGELOG_URL = "https://proliferate.com/changelog";
const PROLIFERATE_DISCORD_URL = "https://discord.gg/7b5afMTqW";

/**
 * The single sidebar bottom-left account block, shared verbatim by the main
 * sidebar and the settings sidebar: avatar + name/organization trigger opening
 * one popover with invitations, the organization switcher, plan, help links,
 * settings/log out and the Proliferate app-version footer.
 */
export function SidebarAccountFooter() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const authStatus = useAuthStore((state) => state.status);
  const { openExternal } = useTauriShellActions();
  const handleSignOut = useAppSidebarSignOutAction();
  const openShortcutsDialog = useKeyboardShortcutsDialogStore((state) => state.setOpen);
  const {
    openBug: openSupport,
    openFeature: openPrompt,
    disabledReason: supportDisabledReason,
  } = useOpenSupportReportWindow({ source: "sidebar" });
  const showToast = useToastStore((state) => state.show);
  const { data: billingPlan } = useCloudBilling();
  const { data: usageSummary } = useUsageSummary(undefined, authStatus === "authenticated");
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

  const displayName = user?.display_name?.trim() || user?.email || "Account";
  const initials = displayName.trim().slice(0, 2).toUpperCase() || "PR";
  const organizationName = activeOrganization?.name ?? null;
  const planLabel = billingPlan
    ? (billingPlan.isPaidCloud ? "Pro" : "Free")
    : null;

  const openExternalUrl = (url: string) => {
    void openExternal(url).catch(() => {
      showToast("Failed to open the link.");
    });
  };

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
      {usageSummary ? (
        <ConsumptionCard
          usageSummary={usageSummary}
          onTopUp={() => {
            navigate("/settings?section=billing");
          }}
        />
      ) : null}
      <div aria-hidden className="h-[0.5px] bg-sidebar-border" />
      <div className="flex items-center px-2 py-2">
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
              className="flex h-10 w-full min-w-0 items-center gap-3 rounded-lg px-2 text-left text-sidebar-foreground hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent"
              title={displayName}
            >
              <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sidebar-accent text-ui-sm font-medium text-sidebar-foreground">
                {user?.avatar_url ? (
                  <img
                    src={user.avatar_url}
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
              {pendingInvitations.length > 0 ? (
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

              <div className={`${pendingInvitations.length > 0 ? "border-t border-border-light" : ""} py-1`}>
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

              {planLabel ? (
                <div className="border-t border-border-light py-1">
                  <PopoverMenuItem
                    variant="sidebar"
                    label="Plan"
                    icon={<CreditCard className="size-4" />}
                    trailing={<span>{planLabel}</span>}
                    onClick={() => {
                      navigate("/settings");
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
                  label="Docs"
                  icon={<BookOpen className="size-4" />}
                  trailing={<ArrowUpRight className="size-3" />}
                  onClick={() => {
                    openExternalUrl(PROLIFERATE_DOCS_URL);
                    close();
                  }}
                />
                <PopoverMenuItem
                  variant="sidebar"
                  label="Changelog"
                  icon={<BookMarked className="size-4" />}
                  trailing={<ArrowUpRight className="size-3" />}
                  onClick={() => {
                    openExternalUrl(PROLIFERATE_CHANGELOG_URL);
                    close();
                  }}
                />
                <PopoverMenuItem
                  variant="sidebar"
                  label="Discord"
                  icon={<Discord className="size-4" />}
                  trailing={<ArrowUpRight className="size-3" />}
                  onClick={() => {
                    openExternalUrl(PROLIFERATE_DISCORD_URL);
                    close();
                  }}
                />
                <PopoverMenuItem
                  variant="sidebar"
                  label="Go to web"
                  icon={<Globe className="size-4" />}
                  trailing={<span>{getShortcutDisplayLabel(SHORTCUTS.openWebApp)}</span>}
                  onClick={() => {
                    openExternalUrl(getProliferateWebBaseUrl());
                    close();
                  }}
                />
                <PopoverMenuItem
                  variant="sidebar"
                  label="Send feedback"
                  icon={<MessageSquare className="size-4" />}
                  trailing={<span>{getShortcutDisplayLabel(SHORTCUTS.openSupport)}</span>}
                  disabled={Boolean(supportDisabledReason)}
                  title={supportDisabledReason ?? undefined}
                  onClick={() => {
                    openSupport();
                    close();
                  }}
                />
                <PopoverMenuItem
                  variant="sidebar"
                  label="Submit a prompt"
                  icon={<Lightbulb className="size-4" />}
                  disabled={Boolean(supportDisabledReason)}
                  title={supportDisabledReason ?? undefined}
                  onClick={() => {
                    openPrompt();
                    close();
                  }}
                />
              </div>

              <div className="border-t border-border-light py-1">
                <PopoverMenuItem
                  variant="sidebar"
                  label="Settings"
                  icon={<Settings className="size-4" />}
                  trailing={<span>{getShortcutDisplayLabel(SHORTCUTS.openSettings)}</span>}
                  onClick={() => {
                    navigate("/settings");
                    close();
                  }}
                />
                <PopoverMenuItem
                  variant="sidebar"
                  label="Log out"
                  icon={<LogOut className="size-4" />}
                  onClick={() => {
                    handleSignOut();
                    close();
                  }}
                />
              </div>

              <AppVersionRow />
            </div>
          )}
        </PopoverButton>
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

/**
 * Popover footer line: `Proliferate v{x}` only. Harness versions (and their
 * tooltip) were dropped by owner decision 2026-07-01.
 */
function AppVersionRow() {
  const { data: appVersion } = useAppVersion();

  return (
    <div className="mt-1 border-t border-border px-2.5 pb-1 pt-2">
      <div className="truncate text-ui-sm text-faint">{`Proliferate v${appVersion ?? "…"}`}</div>
    </div>
  );
}
