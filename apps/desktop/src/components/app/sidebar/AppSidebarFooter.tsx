import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import {
  Check,
  ChevronUpDown,
  ExternalLink,
  LifeBuoy,
  LogOut,
  Mail,
  Settings,
} from "@proliferate/ui/icons";
import { PROLIFERATE_DOCS_URL } from "@/config/capabilities";
import { useAppSidebarSignOutAction } from "@/hooks/app/workflows/use-app-sidebar-sign-out-action";
import { useOrganizationActions } from "@/hooks/access/cloud/organizations/use-organization-actions";
import { useCurrentUserOrganizationInvitations } from "@/hooks/access/cloud/organizations/use-current-user-organization-invitations";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { useOpenSupportReportWindow } from "@/hooks/support/workflows/use-open-support-report-window";
import type {
  OrganizationInvitationRecord,
  OrganizationRecord,
} from "@/lib/domain/organizations/organization-records";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useToastStore } from "@/stores/toast/toast-store";

function OrganizationSwitcherMark({
  organization,
  label,
  className,
}: {
  organization?: Pick<OrganizationRecord, "logoDomain" | "logoImage"> | null;
  label: string;
  className: string;
}) {
  const initials = label.trim().slice(0, 2).toUpperCase() || "OR";
  const baseClassName = `flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-sidebar-border bg-sidebar-accent text-sm font-[520] leading-none text-sidebar-foreground ${className}`;

  if (organization?.logoImage) {
    return (
      <span className={baseClassName}>
        <img src={organization.logoImage} alt="" className="size-full object-cover" />
      </span>
    );
  }

  if (organization?.logoDomain) {
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(organization.logoDomain)}&sz=64`;
    return (
      <span className={baseClassName}>
        <img src={faviconUrl} alt="" className="h-2/3 w-2/3" />
      </span>
    );
  }

  return <span className={baseClassName}>{initials}</span>;
}

export function AppSidebarFooter() {
  const navigate = useNavigate();
  const authStatus = useAuthStore((state) => state.status);
  const { openExternal } = useTauriShellActions();
  const handleSignOut = useAppSidebarSignOutAction();
  const openSupport = useOpenSupportReportWindow({ source: "sidebar" });
  const showToast = useToastStore((state) => state.show);
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
  const pendingInvitations = pendingInvitationsQuery.data?.invitations ?? [];
  const [acceptTarget, setAcceptTarget] = useState<OrganizationInvitationRecord | null>(null);

  const activeLabel = activeOrganization?.name ?? "Organization";

  async function handleAcceptInvitation() {
    if (!acceptTarget) {
      return;
    }
    try {
      const response = await actions.acceptCurrentInvitation(acceptTarget.id);
      setActiveOrganizationId(response.organization.id);
      setAcceptTarget(null);
      showToast(`Joined ${response.organization.name}.`, "info");
    } catch {
      showToast("Invitation could not be accepted.");
    }
  }

  return (
    <div className="shrink-0">
      <div className="flex shrink-0 items-center border-t !border-sidebar-border/75 px-3 py-3">
        <PopoverButton
          align="start"
          side="top"
          offset={8}
          trigger={(
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              className="h-10 w-full min-w-0 justify-start rounded-lg px-2 text-sidebar-foreground hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent"
              title={activeLabel}
            >
              <OrganizationSwitcherMark
                organization={activeOrganization}
                label={activeLabel}
                className="size-6 rounded-md"
              />
              <span className="min-w-0 flex-1 truncate text-left text-sm font-[430] leading-4">
                {activeLabel}
              </span>
              <ChevronUpDown className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
            </Button>
          )}
          className={`w-72 ${POPOVER_SURFACE_CLASS}`}
        >
          {(close) => (
            <div className="max-h-[28rem] overflow-y-auto">
              <div className="px-2 py-2">
                <div className="text-xs leading-4 text-muted-foreground">Active organization</div>
                <div className="mt-1 flex min-w-0 items-center gap-2">
                  <OrganizationSwitcherMark
                    organization={activeOrganization}
                    label={activeLabel}
                    className="size-8"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-[520] leading-4 text-foreground">
                      {activeLabel}
                    </div>
                    <div className="truncate text-xs leading-4 text-muted-foreground">
                      {activeOrganizationId ? "Organization workspace" : "No organization selected"}
                    </div>
                  </div>
                </div>
              </div>

              {pendingInvitations.length > 0 ? (
                <div className="border-t border-border-light py-1">
                  <div className="px-2 py-1 text-xs leading-4 text-muted-foreground">
                    Pending invitations
                  </div>
                  {pendingInvitations.map((invitation) => (
                    <PopoverMenuItem
                      key={invitation.id}
                      variant="sidebar"
                      label={invitation.organizationName ?? invitation.email}
                      icon={<Mail className="size-3.5" />}
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

              <div className="border-t border-border-light py-1">
                {organizationsQuery.isLoading ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    Loading organizations...
                  </div>
                ) : organizationsQuery.isError ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    Organizations could not be loaded.
                  </div>
                ) : organizations.length > 0 ? (
                  organizations.map((organization) => (
                    <PopoverMenuItem
                      key={organization.id}
                      variant="sidebar"
                      label={organization.name}
                      icon={(
                        <OrganizationSwitcherMark
                          organization={organization}
                          label={organization.name}
                          className="size-5"
                        />
                      )}
                      iconClassName="opacity-100"
                      trailing={
                        organization.id === activeOrganizationId
                          ? <Check className="size-3.5" />
                          : undefined
                      }
                      onClick={() => {
                        setActiveOrganizationId(organization.id);
                        close();
                      }}
                    />
                  ))
                ) : (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No organizations yet.
                  </div>
                )}
              </div>

              <div className="border-t border-border-light py-1">
                <PopoverMenuItem
                  variant="sidebar"
                  label="Settings"
                  icon={<Settings className="size-3.5" />}
                  onClick={() => {
                    navigate("/settings");
                    close();
                  }}
                />
              </div>

              <div className="border-t border-border-light py-1">
                <PopoverMenuItem
                  variant="sidebar"
                  label="Docs"
                  icon={<ExternalLink className="size-3.5" />}
                  onClick={() => {
                    void openExternal(PROLIFERATE_DOCS_URL);
                    close();
                  }}
                />
                <PopoverMenuItem
                  variant="sidebar"
                  label="Support"
                  icon={<LifeBuoy className="size-3.5" />}
                  onClick={() => {
                    openSupport();
                    close();
                  }}
                />
                <PopoverMenuItem
                  variant="sidebar"
                  label="Log out"
                  icon={<LogOut className="size-3.5" />}
                  onClick={() => {
                    handleSignOut();
                    close();
                  }}
                />
              </div>
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
            : "Accept this invitation and join the organization."
        }
        confirmLabel="Accept invitation"
        loading={actions.acceptingCurrentInvitation}
        disableClose={actions.acceptingCurrentInvitation}
        onClose={() => setAcceptTarget(null)}
        onConfirm={() => {
          void handleAcceptInvitation();
        }}
      />
    </div>
  );
}
