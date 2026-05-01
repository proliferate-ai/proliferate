import { AUTH_ACCOUNT_LABELS } from "@/config/auth";
import { CAPABILITY_COPY } from "@/config/capabilities";

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
  isAuthenticated: boolean;
  localMode: boolean;
  signInUnavailable: boolean;
}

export interface AccountActionDescriptionInput extends AccountProfileSummaryInput {
  githubLogin: string | null;
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
  isAuthenticated,
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
  return isAuthenticated ? "Username unavailable" : "Not connected";
}

export function getAccountActionDescription({
  devAuthBypassed,
  isAuthenticated,
  localMode,
  signInUnavailable,
  signedInWhileCloudUnavailable,
  githubLogin,
}: AccountActionDescriptionInput): string {
  if (devAuthBypassed) {
    return "Auth is bypassed for this local development build.";
  }
  if (signedInWhileCloudUnavailable) {
    return "Cloud is unavailable, but you can still manage GitHub access or sign out.";
  }
  if (isAuthenticated) {
    return githubLogin
      ? "Reconnect GitHub, manage repository access, or sign out from this device."
      : "Reconnect GitHub to refresh account details, or sign out from this device.";
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
