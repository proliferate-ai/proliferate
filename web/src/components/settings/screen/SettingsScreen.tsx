import { Apple, CircleUserRound, CreditCard, Github, GitBranch, LifeBuoy, UsersRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { AuthProviderName } from "@proliferate/cloud-sdk";
import type {
  AccountProviderView,
  AccountSettingsPaneProps,
} from "@proliferate/product-ui/account/AccountSettingsPane";
import { AccountSettingsPane } from "@proliferate/product-ui/account/AccountSettingsPane";
import { GoogleGlyph } from "@proliferate/product-ui/auth/GoogleGlyph";
import { SettingsCard } from "@proliferate/product-ui/settings/SettingsCard";
import { SettingsCardRow } from "@proliferate/product-ui/settings/SettingsCardRow";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { SettingsShell } from "@proliferate/product-ui/settings/SettingsShell";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  useAuthViewer,
  useCurrentTeam,
  useCurrentTeamCheckout,
  useTeamCheckoutActions,
} from "@proliferate/cloud-sdk-react";

import { routes } from "../../../config/routes";
import { startWebAuthFlow } from "../../../lib/access/cloud/auth/web-auth-flow";
import { useAuthToken } from "../../../providers/WebCloudProvider";
import { BillingSettingsSection } from "./BillingSettingsSection";
import { EnvironmentsSettingsSection } from "./EnvironmentsSettingsSection";

type SettingsSectionId = "account" | "environments" | "organization" | "teams" | "billing" | "support";
const SETTINGS_ICON_SIZE = 14;

export function SettingsScreen() {
  const viewer = useAuthViewer();
  const { token, clearToken } = useAuthToken();
  const navigate = useNavigate();
  const { sectionId } = useParams();
  const activeSection = sectionId === "teams"
    ? "organization"
    : isSettingsSectionId(sectionId)
      ? sectionId
      : "account";
  const [loadingProvider, setLoadingProvider] = useState<AuthProviderName | "sign-out" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startProvider(provider: AuthProviderName, purpose: "link" | "required_github_link" = "link") {
    if (loadingProvider || !token) {
      return;
    }
    setError(null);
    setLoadingProvider(provider);
    try {
      await startWebAuthFlow({
        provider,
        purpose,
        accessToken: token,
      });
    } catch (authError) {
      setLoadingProvider(null);
      setError(authError instanceof Error ? authError.message : "Provider linking could not start.");
    }
  }

  async function signOut() {
    setLoadingProvider("sign-out");
    try {
      await clearToken();
    } finally {
      setLoadingProvider(null);
    }
  }

  return (
    <div className="h-full" data-telemetry-block>
      <SettingsShell
        activeSectionId={activeSection}
        groups={[
          {
            items: [
              {
                id: "account",
                label: "Account",
                icon: <CircleUserRound size={SETTINGS_ICON_SIZE} />,
              },
              {
                id: "environments",
                label: "Environments",
                icon: <GitBranch size={SETTINGS_ICON_SIZE} />,
              },
              {
                id: "organization",
                label: "Organization",
                icon: <UsersRound size={SETTINGS_ICON_SIZE} />,
              },
              {
                id: "billing",
                label: "Billing",
                icon: <CreditCard size={SETTINGS_ICON_SIZE} />,
              },
              {
                id: "support",
                label: "Support",
                icon: <LifeBuoy size={SETTINGS_ICON_SIZE} />,
              },
            ],
          },
        ]}
        onSelectSection={(id) => {
          if (isSettingsSectionId(id)) {
            navigate(routes.settingsSection(id));
          }
        }}
        contentClassName={activeSection === "billing" ? "max-w-6xl" : undefined}
      >
        {activeSection === "account" ? (
          <AccountSection
            props={buildAccountSettingsProps({
              viewer: viewer.data,
              loadingProvider,
              error,
              connectGitHub: () => void startProvider("github", "required_github_link"),
              connectGoogle: () => void startProvider("google"),
              connectApple: () => void startProvider("apple"),
              signOut: () => void signOut(),
            })}
          />
        ) : activeSection === "environments" ? (
          <EnvironmentsSettingsSection />
        ) : activeSection === "organization" ? (
          <OrganizationSection />
        ) : activeSection === "billing" ? (
          <BillingSettingsSection />
        ) : (
          <SupportSection onOpenSupport={() => navigate(routes.support)} />
        )}
      </SettingsShell>
    </div>
  );
}

function isSettingsSectionId(value: string | undefined): value is SettingsSectionId {
  return (
    value === "account"
    || value === "environments"
    || value === "organization"
    || value === "teams"
    || value === "billing"
    || value === "support"
  );
}

function AccountSection({ props }: { props: AccountSettingsPaneProps }) {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Account & providers"
        description="Manage the product identity Web uses for cloud sessions, automations, and provider linking."
      />
      <AccountSettingsPane {...props} />
    </section>
  );
}

function OrganizationSection() {
  const currentTeam = useCurrentTeam();
  const checkout = useCurrentTeamCheckout();
  const checkoutActions = useTeamCheckoutActions();
  const [teamName, setTeamName] = useState("");
  const [inviteEmails, setInviteEmails] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  async function createTeam(event: FormEvent) {
    event.preventDefault();
    setActionError(null);
    try {
      const response = await checkoutActions.createTeamCheckout({
        teamName,
        inviteEmails: inviteEmails
          .split(",")
          .map((email) => email.trim())
          .filter(Boolean),
      });
      window.location.assign(response.url);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Team checkout could not start.");
    }
  }

  async function continueCheckout() {
    const url = checkout.data?.intent?.checkoutUrl;
    if (url) {
      window.location.assign(url);
    }
  }

  const pendingCheckout = !currentTeam.data ? (checkout.data?.intent ?? null) : null;

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Organization"
        description="Create or join one team for shared work, members, invites, shared sandbox setup, and Team billing."
      />
      {actionError ? (
        <SettingsCard>
          <SettingsCardRow label="Action failed" description={actionError} />
        </SettingsCard>
      ) : null}
      {pendingCheckout ? (
        <SettingsCard>
          <SettingsCardRow
            label={pendingCheckout.teamName}
            description="Team checkout is pending. Continue checkout or cancel setup."
          >
            <div className="flex gap-2">
              <ActionButton onClick={() => void continueCheckout()}>Continue</ActionButton>
              <ActionButton
                disabled={checkoutActions.cancelingTeamCheckout}
                onClick={() => void checkoutActions.cancelTeamCheckout(pendingCheckout.id)}
              >
                Cancel
              </ActionButton>
            </div>
          </SettingsCardRow>
        </SettingsCard>
      ) : (
        <SettingsCard>
          {currentTeam.isLoading ? (
            <SettingsCardRow label="Organization" description="Loading team..." />
          ) : currentTeam.isError ? (
            <SettingsCardRow
              label="Organization"
              description="Team could not be loaded."
            >
              <ActionButton onClick={() => void currentTeam.refetch()}>Retry</ActionButton>
            </SettingsCardRow>
          ) : currentTeam.data ? (
            <SettingsCardRow
              label={currentTeam.data.name}
              description={currentTeam.data.membership
                ? `${membershipRoleLabel(currentTeam.data.membership.role)} - ${membershipStatusLabel(currentTeam.data.membership.status)}`
                : "Current team"}
            >
              <Badge tone={currentTeam.data.status === "active" ? "success" : "warning"}>
                {currentTeam.data.status === "suspended" ? "Billing repair" : "Active"}
              </Badge>
            </SettingsCardRow>
          ) : (
            <div className="space-y-4 p-4">
              <div className="space-y-1">
                <h2 className="text-sm font-medium text-foreground">You are not in a team yet.</h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  Create a team to invite people, manage shared work, and use Team billing.
                </p>
              </div>
              <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={createTeam}>
                <input
                  className="min-h-9 rounded-md border border-border-light bg-background px-3 text-sm"
                  placeholder="Team name"
                  value={teamName}
                  onChange={(event) => setTeamName(event.currentTarget.value)}
                />
                <input
                  className="min-h-9 rounded-md border border-border-light bg-background px-3 text-sm"
                  placeholder="Invite emails, comma separated"
                  value={inviteEmails}
                  onChange={(event) => setInviteEmails(event.currentTarget.value)}
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!teamName.trim() || checkoutActions.creatingTeamCheckout}
                >
                  Create team
                </Button>
              </form>
            </div>
          )}
        </SettingsCard>
      )}
    </section>
  );
}

function ActionButton({
  children,
  disabled,
  onClick,
}: {
  children: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function SupportSection({ onOpenSupport }: { onOpenSupport: () => void }) {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Support"
        description="Open support and product help for cloud sessions, automations, and Desktop handoff."
      />
      <SettingsCard>
        <SettingsCardRow
          label="Product support"
          description="Send a support message from the dedicated support surface."
        >
          <ActionButton onClick={onOpenSupport}>Open support</ActionButton>
        </SettingsCardRow>
        <SettingsCardRow
          label="Diagnostics"
          description="Telemetry-sensitive support surfaces stay blocked from session replay."
        />
      </SettingsCard>
    </section>
  );
}

function membershipRoleLabel(role: string): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "member":
      return "Member";
    default:
      return role;
  }
}

function membershipStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "removed":
      return "Removed";
    default:
      return status;
  }
}

function buildAccountSettingsProps({
  viewer,
  loadingProvider,
  error,
  connectGitHub,
  connectGoogle,
  connectApple,
  signOut,
}: {
  viewer: ReturnType<typeof useAuthViewer>["data"];
  loadingProvider: AuthProviderName | "sign-out" | null;
  error: string | null;
  connectGitHub: () => void;
  connectGoogle: () => void;
  connectApple: () => void;
  signOut: () => void;
}): AccountSettingsPaneProps {
  const user = viewer?.user;
  const linkedProviders = viewer?.linkedProviders ?? [];
  const providerAvailability = viewer?.providerAvailability ?? [];
  const githubIdentity = linkedProviders.find((provider) => provider.provider === "github");
  const displayName = user?.display_name?.trim() || user?.email?.split("@")[0] || "Proliferate";
  const githubLabel = user?.github_login
    ? `@${user.github_login}`
    : githubIdentity?.accountEmail ?? (viewer?.githubConnected ? "Connected" : "Required");

  return {
    displayName,
    email: user?.email ?? "Signed in",
    avatarUrl: user?.avatar_url ?? null,
    profileSummary: viewer?.githubConnected
      ? "Ready for cloud workspaces and automations."
      : "GitHub is required before cloud workspaces and automations can run end to end.",
    githubLabel,
    providers: buildProviderViews(linkedProviders, providerAvailability, Boolean(viewer?.githubConnected)),
    actions: {
      connectGitHub: viewer?.githubConnected
        ? undefined
        : {
            label: "Connect GitHub",
            icon: <Github size={13} />,
            loading: loadingProvider === "github",
            disabled: Boolean(loadingProvider),
            onClick: connectGitHub,
          },
      connectGoogle: {
        label: "Add Google",
        icon: <GoogleGlyph className="text-[13px]" />,
        loading: loadingProvider === "google",
        disabled: Boolean(loadingProvider) || !providerEnabled(providerAvailability, "google"),
        onClick: connectGoogle,
      },
      connectApple: {
        label: "Add Apple",
        icon: <Apple size={13} />,
        loading: loadingProvider === "apple",
        disabled: Boolean(loadingProvider) || !providerEnabled(providerAvailability, "apple"),
        onClick: connectApple,
      },
      signOut: {
        label: "Sign out",
        loading: loadingProvider === "sign-out",
        disabled: Boolean(loadingProvider),
        destructive: true,
        onClick: signOut,
      },
    },
    error,
  };
}

function buildProviderViews(
  linkedProviders: NonNullable<ReturnType<typeof useAuthViewer>["data"]>["linkedProviders"],
  providerAvailability: NonNullable<ReturnType<typeof useAuthViewer>["data"]>["providerAvailability"],
  githubConnected: boolean,
): AccountProviderView[] {
  const providers: AccountProviderView[] = [];
  const github = linkedProviders.find((provider) => provider.provider === "github");
  providers.push({
    provider: "github",
    label: "GitHub",
    accountLabel: github?.accountEmail ?? github?.accountId ?? (githubConnected ? "Connected" : "Required"),
    connected: githubConnected,
    primary: true,
  });

  const googleProviders = linkedProviders.filter((provider) => provider.provider === "google");
  if (googleProviders.length > 0) {
    providers.push(
      ...googleProviders.map((provider) => ({
        provider: "google" as const,
        label: "Google",
        accountLabel: provider.accountEmail ?? provider.accountId ?? "Connected",
        connected: true,
      })),
    );
  } else {
    providers.push({
      provider: "google",
      label: "Google",
      accountLabel: providerEnabled(providerAvailability, "google")
        ? "Not connected"
        : "Not configured in this environment",
      connected: false,
    });
  }

  const apple = linkedProviders.find((provider) => provider.provider === "apple");
  providers.push({
    provider: "apple",
    label: "Apple",
    accountLabel: apple?.accountEmail
      ?? apple?.accountId
      ?? (providerEnabled(providerAvailability, "apple") ? "Not connected" : "Not configured in this environment"),
    connected: Boolean(apple?.connected),
  });

  return providers;
}

function providerEnabled(
  providers: NonNullable<ReturnType<typeof useAuthViewer>["data"]>["providerAvailability"],
  provider: AuthProviderName,
) {
  return providers.find((item) => item.provider === provider)?.enabled !== false;
}
