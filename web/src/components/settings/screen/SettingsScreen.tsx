import { Apple, Cloud, CreditCard, Github, LifeBuoy, Monitor, ShieldCheck } from "lucide-react";
import { useState } from "react";

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
import {
  useAuthViewer,
  useCloudBilling,
  useCloudBillingActions,
  useOrganizations,
} from "@proliferate/cloud-sdk-react";

import { startWebAuthFlow } from "../../../lib/access/cloud/auth/web-auth-flow";
import { useAuthToken } from "../../../providers/WebCloudProvider";

type SettingsSectionId = "account" | "appearance" | "cloud" | "billing" | "support";

export function SettingsScreen() {
  const viewer = useAuthViewer();
  const { token, clearToken } = useAuthToken();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("account");
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
                icon: <ShieldCheck size={15} />,
              },
              {
                id: "appearance",
                label: "Appearance",
                icon: <Monitor size={15} />,
              },
              {
                id: "cloud",
                label: "Cloud",
                icon: <Cloud size={15} />,
              },
              {
                id: "billing",
                label: "Billing",
                icon: <CreditCard size={15} />,
              },
              {
                id: "support",
                label: "Support",
                icon: <LifeBuoy size={15} />,
              },
            ],
          },
        ]}
        onSelectSection={(id) => setActiveSection(id as SettingsSectionId)}
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
        ) : activeSection === "billing" ? (
          <BillingSection />
        ) : (
          <PlaceholderSection id={activeSection} />
        )}
      </SettingsShell>
    </div>
  );
}

function AccountSection({ props }: { props: AccountSettingsPaneProps }) {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Account"
        description="Manage the product identity Web uses for cloud sessions, automations, and provider linking."
      />
      <AccountSettingsPane {...props} />
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
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-border-light bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-border-heavy disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
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

function PlaceholderSection({
  id,
}: {
  id: Exclude<SettingsSectionId, "account" | "billing">;
}) {
  const copy = {
    appearance: {
      title: "Appearance",
      description: "Theme controls will live here once Web has the same theme picker as Desktop.",
      row: "Web is currently using the shared Desktop theme tokens.",
    },
    cloud: {
      title: "Cloud",
      description: "Cloud sandbox settings will move here as the shared sandbox model lands.",
      row: "Workspace, automation, and MCP configuration will use shared UI once the cloud APIs are wired.",
    },
    support: {
      title: "Support",
      description: "Support links and diagnostics will be exposed here.",
      row: "This placeholder keeps the settings shell structure stable while the support surface is connected.",
    },
  }[id];

  return (
    <section className="space-y-6">
      <SettingsPageHeader title={copy.title} description={copy.description} />
      <SettingsCard>
        <SettingsCardRow label={copy.title} description={copy.row} />
      </SettingsCard>
    </section>
  );
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
