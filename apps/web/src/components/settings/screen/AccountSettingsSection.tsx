import type { AuthProviderName } from "@proliferate/cloud-sdk";
import type {
  AccountPasswordCredentialSubmit,
  AccountProviderView,
  AccountSettingsPaneProps,
} from "@proliferate/product-ui/account/AccountSettingsPane";
import { AccountSettingsPane } from "@proliferate/product-ui/account/AccountSettingsPane";
import { ProviderBrandIcon } from "@proliferate/product-ui/auth/ProviderBrandIcon";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";

import { useWebAccountSettingsActions } from "../../../hooks/settings/workflows/use-web-account-settings-actions";

export function AccountSettingsSection() {
  const account = useWebAccountSettingsActions();

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Account & providers"
        description="Manage the product identity Web uses for cloud sessions, workflows, and provider linking."
      />
      <AccountSettingsPane
        {...buildAccountSettingsProps({
          viewer: account.viewer,
          loadingProvider: account.loadingProvider,
          error: account.error,
          connectGitHub: account.connectGitHub,
          connectGoogle: account.connectGoogle,
          connectApple: account.connectApple,
          setPassword: account.setPassword,
          signOut: account.signOut,
        })}
      />
    </section>
  );
}

type AccountViewer = ReturnType<typeof useWebAccountSettingsActions>["viewer"];

function buildAccountSettingsProps({
  viewer,
  loadingProvider,
  error,
  connectGitHub,
  connectGoogle,
  connectApple,
  setPassword,
  signOut,
}: {
  viewer: AccountViewer;
  loadingProvider: AuthProviderName | "sign-out" | null;
  error: string | null;
  connectGitHub: () => void;
  connectGoogle: () => void;
  connectApple: () => void;
  setPassword: (input: AccountPasswordCredentialSubmit) => void | Promise<void>;
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
      ? "Ready for cloud workspaces and workflows."
      : "GitHub is required before cloud workspaces and workflows can run end to end.",
    githubLabel,
    providers: buildProviderViews(linkedProviders, providerAvailability, Boolean(viewer?.githubConnected)),
    passwordCredential: {
      enabled: viewer?.passwordCredential.enabled ?? false,
      setAt: viewer?.passwordCredential.setAt ?? null,
      loading: !viewer,
      disabled: !viewer,
      onSubmit: setPassword,
    },
    actions: {
      connectGitHub: viewer?.githubConnected
        ? undefined
        : {
            label: "Connect GitHub",
            icon: <ProviderBrandIcon provider="github" className="size-[13px]" />,
            loading: loadingProvider === "github",
            disabled: Boolean(loadingProvider),
            onClick: connectGitHub,
          },
      connectGoogle: {
        label: "Add Google",
        icon: <ProviderBrandIcon provider="google" className="size-[13px]" />,
        loading: loadingProvider === "google",
        disabled: Boolean(loadingProvider) || !providerEnabled(providerAvailability, "google"),
        onClick: connectGoogle,
      },
      connectApple: {
        label: "Add Apple",
        icon: <ProviderBrandIcon provider="apple" className="size-[13px]" />,
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
  linkedProviders: NonNullable<AccountViewer>["linkedProviders"],
  providerAvailability: NonNullable<AccountViewer>["providerAvailability"],
  githubConnected: boolean,
): AccountProviderView[] {
  const ssoProviders = linkedProviders.filter((provider) => (
    provider.provider === "sso" && provider.connected
  ));
  const providers: AccountProviderView[] = ssoProviders.map((provider) => ({
    provider: "sso",
    label: provider.displayName ?? "SSO",
    accountLabel: provider.accountEmail ?? provider.accountId ?? "Connected",
    connected: true,
  }));
  const github = linkedProviders.find((provider) => provider.provider === "github");
  providers.push({
    provider: "github",
    label: "GitHub",
    accountLabel: github?.accountEmail ?? github?.accountId ?? (githubConnected ? "Connected" : "Required"),
    connected: githubConnected,
    primary: githubConnected,
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
  providers: NonNullable<AccountViewer>["providerAvailability"],
  provider: AuthProviderName,
) {
  return providers.find((item) => item.provider === provider)?.enabled !== false;
}
