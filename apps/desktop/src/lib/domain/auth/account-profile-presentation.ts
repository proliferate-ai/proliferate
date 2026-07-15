import type { AccountProviderView } from "@proliferate/product-ui/account/AccountSettingsPane";
import { AUTH_ACCOUNT_LABELS } from "@/copy/auth/auth-copy";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";

export interface AccountDisplayNameInput {
  email: string | null | undefined;
  displayName: string | null | undefined;
  githubLogin: string | null;
  isAuthenticated: boolean;
  devAuthBypassed: boolean;
  localMode: boolean;
}

export interface AccountProfileSummaryInput {
  devAuthBypassed: boolean;
  isAuthenticated: boolean;
  localMode: boolean;
  signInUnavailable: boolean;
  signedInWhileCloudUnavailable: boolean;
}

export interface GitHubStatusLabelInput {
  cloudSignInChecking: boolean;
  devAuthBypassed: boolean;
  localMode: boolean;
  signInUnavailable: boolean;
}

export interface AccountActionDescriptionInput extends AccountProfileSummaryInput {
  githubConnected: boolean;
}

export function getAccountDisplayName({
  email,
  displayName,
  githubLogin,
  isAuthenticated,
  devAuthBypassed,
  localMode,
}: AccountDisplayNameInput): string {
  if (displayName?.trim()) {
    return displayName.trim();
  }
  if (githubLogin) {
    return githubLogin;
  }
  if (email?.trim()) {
    return email.split("@")[0] || email;
  }
  if (devAuthBypassed) {
    return AUTH_ACCOUNT_LABELS.devBypassTitle;
  }
  if (isAuthenticated) {
    return "Signed in";
  }
  return localMode ? "Local mode" : AUTH_ACCOUNT_LABELS.anonymousTitle;
}

export function getAccountProfileSummary({
  devAuthBypassed,
  isAuthenticated,
  localMode,
  signInUnavailable,
  signedInWhileCloudUnavailable,
}: AccountProfileSummaryInput): string {
  if (devAuthBypassed) {
    return AUTH_ACCOUNT_LABELS.devBypassDescription;
  }
  if (signedInWhileCloudUnavailable) {
    return CAPABILITY_COPY.githubSignedInUnavailableDescription;
  }
  if (isAuthenticated) {
    return "Signed in to Proliferate.";
  }
  if (localMode) {
    return CAPABILITY_COPY.accountLocalDescription;
  }
  if (signInUnavailable) {
    return CAPABILITY_COPY.accountAuthUnavailableDescription;
  }
  return AUTH_ACCOUNT_LABELS.anonymousDescription;
}

export function getGitHubStatusLabel({
  cloudSignInChecking,
  devAuthBypassed,
  localMode,
  signInUnavailable,
}: GitHubStatusLabelInput): string {
  if (devAuthBypassed) {
    return "Bypassed";
  }
  if (cloudSignInChecking) {
    return "Checking...";
  }
  if (localMode || signInUnavailable) {
    return "Unavailable";
  }
  return "Not connected";
}

export function getAccountActionDescription({
  devAuthBypassed,
  isAuthenticated,
  localMode,
  signInUnavailable,
  signedInWhileCloudUnavailable,
  githubConnected,
}: AccountActionDescriptionInput): string {
  if (devAuthBypassed) {
    return "Auth is bypassed for this local development build.";
  }
  if (signedInWhileCloudUnavailable) {
    return githubConnected
      ? "Cloud is unavailable, but you can still manage GitHub access or sign out."
      : "Cloud is unavailable, but you can still sign out from this device.";
  }
  if (isAuthenticated) {
    return githubConnected
      ? "Reconnect GitHub, manage repository access, or sign out from this device."
      : "Connect GitHub to enable repository access, or sign out from this device.";
  }
  if (localMode || signInUnavailable) {
    return "Cloud sign-in is unavailable in this environment.";
  }
  return "Connect GitHub to use cloud workspaces and credential sync.";
}

export function getAccountInitials(displayName: string): string {
  const parts = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return "P";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export interface AccountProviderViewsInput {
  githubAccountLabel: string | null;
  githubConnected: boolean;
  googleAccounts: Array<{ accountEmail?: string | null; accountId?: string | null }>;
  ssoAccounts: Array<{
    accountEmail?: string | null;
    accountId?: string | null;
    displayName?: string | null;
    brandLabel?: string | null;
  }>;
  googleAvailable: boolean;
  showProviders: boolean;
}

export function buildAccountProviderViews({
  githubAccountLabel,
  githubConnected,
  googleAccounts,
  ssoAccounts,
  googleAvailable,
  showProviders,
}: AccountProviderViewsInput): AccountProviderView[] {
  if (!showProviders) {
    return [
      {
        provider: "github",
        label: "GitHub",
        accountLabel: "Not signed in",
        connected: false,
        primary: false,
      },
    ];
  }

  const providers: AccountProviderView[] = ssoAccounts.map((account) => ({
    provider: "sso" as const,
    label: account.displayName ?? "SSO",
    brandLabel: account.brandLabel ?? account.displayName ?? null,
    accountLabel: account.accountEmail ?? account.accountId ?? "Connected",
    connected: true,
  }));

  providers.push(
    {
      provider: "github",
      label: "GitHub",
      accountLabel: githubConnected ? githubAccountLabel ?? "Connected" : "Not connected",
      connected: githubConnected,
      primary: githubConnected,
    },
  );

  if (googleAccounts.length > 0) {
    providers.push(
      ...googleAccounts.map((account) => ({
        provider: "google" as const,
        label: "Google",
        accountLabel: account.accountEmail ?? account.accountId ?? "Connected",
        connected: true,
      })),
    );
  } else {
    providers.push({
      provider: "google",
      label: "Google",
      accountLabel: googleAvailable ? "Not connected" : "Not configured in this environment",
      connected: false,
    });
  }

  return providers;
}
