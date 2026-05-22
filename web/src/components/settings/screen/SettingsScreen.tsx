import { Apple, CircleUserRound, CreditCard, Github, LifeBuoy, UsersRound } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { AuthProviderName, BillingPlanInfo, CloudOwnerSelection } from "@proliferate/cloud-sdk";
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
  useCloudBilling,
  useCloudBillingActions,
  useOrganizations,
} from "@proliferate/cloud-sdk-react";

import { routes } from "../../../config/routes";
import { startWebAuthFlow } from "../../../lib/access/cloud/auth/web-auth-flow";
import { useAuthToken } from "../../../providers/WebCloudProvider";

type SettingsSectionId = "account" | "teams" | "billing" | "support";
const SETTINGS_ICON_SIZE = 14;

export function SettingsScreen() {
  const viewer = useAuthViewer();
  const { token, clearToken } = useAuthToken();
  const navigate = useNavigate();
  const { sectionId } = useParams();
  const activeSection = isSettingsSectionId(sectionId) ? sectionId : "account";
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
                id: "teams",
                label: "Teams",
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
        ) : activeSection === "teams" ? (
          <TeamsSection />
        ) : activeSection === "billing" ? (
          <BillingSection />
        ) : (
          <SupportSection onOpenSupport={() => navigate(routes.support)} />
        )}
      </SettingsShell>
    </div>
  );
}

function isSettingsSectionId(value: string | undefined): value is SettingsSectionId {
  return value === "account" || value === "teams" || value === "billing" || value === "support";
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

function TeamsSection() {
  const organizations = useOrganizations();
  const organizationList = organizations.data?.organizations ?? [];

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Teams"
        description="Review organizations available to Web cloud sessions, shared environments, billing, and team automation scopes."
      />
      <SettingsCard>
        {organizations.isLoading ? (
          <SettingsCardRow label="Organizations" description="Loading teams..." />
        ) : organizations.isError ? (
          <SettingsCardRow
            label="Organizations"
            description="Teams could not be loaded."
          >
            <ActionButton onClick={() => void organizations.refetch()}>Retry</ActionButton>
          </SettingsCardRow>
        ) : organizationList.length === 0 ? (
          <SettingsCardRow
            label="No teams"
            description="You are not a member of any Proliferate organization yet."
          />
        ) : (
          organizationList.map((organization) => {
            const membership = organization.membership;
            return (
              <SettingsCardRow
                key={organization.id}
                label={organization.name}
                description={membership
                  ? `${membershipRoleLabel(membership.role)} - ${membershipStatusLabel(membership.status)}`
                  : "No active membership"}
              >
                <Badge tone={membership?.status === "active" ? "success" : "neutral"}>
                  {membership?.role ?? "viewer"}
                </Badge>
              </SettingsCardRow>
            );
          })
        )}
      </SettingsCard>
    </section>
  );
}

function BillingSection() {
  const organizations = useOrganizations();
  const adminOrganizations = (organizations.data?.organizations ?? []).filter((organization) => {
    const role = organization.membership?.role;
    return organization.membership?.status === "active" && (role === "owner" || role === "admin");
  });

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Billing"
        description="Manage cloud access, included runtime, and billing status."
      />
      <BillingOwnerCard title="Personal billing" />
      {organizations.isLoading ? (
        <SettingsCard>
          <SettingsCardRow label="Organization billing" description="Loading organizations..." />
        </SettingsCard>
      ) : null}
      {adminOrganizations.map((organization) => (
        <BillingOwnerCard
          key={organization.id}
          title={`${organization.name} billing`}
          owner={{ ownerScope: "organization", organizationId: organization.id }}
        />
      ))}
    </section>
  );
}

function BillingOwnerCard({
  title,
  owner,
}: {
  title: string;
  owner?: CloudOwnerSelection;
}) {
  const billing = useCloudBilling(owner);
  const billingActions = useCloudBillingActions(owner);
  const billingPlan = billing.data;
  const busy = billingActions.creatingBillingPortal || billingActions.creatingCloudCheckout;
  const [actionError, setActionError] = useState<string | null>(null);

  async function openBillingAction(action: "checkout" | "portal") {
    setActionError(null);
    try {
      const response = action === "portal"
        ? await billingActions.createBillingPortal()
        : await billingActions.createCloudCheckout();
      window.location.assign(response.url);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Billing action could not start.");
    }
  }

  return (
    <SettingsCard>
      {billing.isLoading && !billingPlan ? (
        <SettingsCardRow label={title} description="Loading billing state..." />
      ) : null}
      {billing.isError ? (
        <SettingsCardRow
          label={title}
          description="Billing details could not be loaded."
        >
          <ActionButton onClick={() => void billing.refetch()}>Retry</ActionButton>
        </SettingsCardRow>
      ) : null}
      {actionError ? (
        <SettingsCardRow label="Billing action failed" description={actionError} />
      ) : null}
      {billingPlan ? (
        <>
          <SettingsCardRow
            label={`${title}: ${planLabel(billingPlan)}`}
            description={billingDescription(billingPlan)}
          >
            {billingPlan.isPaidCloud ? (
              <ActionButton
                disabled={busy}
                onClick={() => void openBillingAction("portal")}
              >
                Manage
              </ActionButton>
            ) : (
              <ActionButton
                disabled={busy}
                onClick={() => void openBillingAction("checkout")}
              >
                Upgrade
              </ActionButton>
            )}
          </SettingsCardRow>
          <SettingsCardRow
            label="Cloud runtime"
            description={`${formatHours(runtimeRemainingHours(billingPlan))} remaining · ${
              billingPlan.activeSandboxCount
            } active`}
          />
          {billingPlan.billingMode === "enforce" && billingPlan.startBlocked ? (
            <SettingsCardRow
              label="Cloud is paused"
              description={startBlockLabel(billingPlan.startBlockReason)}
            />
          ) : null}
        </>
      ) : null}
    </SettingsCard>
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

function planLabel(plan: BillingPlanInfo): string {
  if (plan.isUnlimited) {
    return "Unlimited";
  }
  if (plan.isPaidCloud) {
    return "Pro";
  }
  return "Free";
}

function billingDescription(plan: BillingPlanInfo): string {
  if (plan.billingMode === "enforce" && plan.startBlocked) {
    return startBlockLabel(plan.startBlockReason);
  }
  if (plan.isPaidCloud) {
    return "Personal cloud billing is active.";
  }
  return "Upgrade when you need more included cloud runtime.";
}

function runtimeRemainingHours(plan: BillingPlanInfo): number | null {
  return (
    plan.proBillingEnabled && plan.isPaidCloud
      ? plan.remainingManagedCloudHours
      : plan.remainingSandboxHours
  ) ?? null;
}

function formatHours(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "Unlimited";
  }
  return `${Math.max(value, 0).toFixed(value < 10 ? 1 : 0)}h`;
}

function startBlockLabel(reason: string | null | undefined): string {
  switch (reason) {
    case "credits_exhausted":
      return "Included cloud runtime has been used.";
    case "overage_disabled":
      return "Overage billing is off.";
    case "cap_exhausted":
      return "The overage cap has been reached.";
    case "payment_failed":
      return "Payment needs attention.";
    case "concurrency_limit":
      return "The active sandbox limit has been reached.";
    default:
      return "Cloud usage is blocked until billing is resolved.";
  }
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
