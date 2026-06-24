export type WebAuthErrorActionKind = "open_desktop" | "try_again" | "go_home";

export interface WebAuthErrorAction {
  kind: WebAuthErrorActionKind;
  label: string;
}

export interface WebAuthErrorPresentation {
  title: string;
  description: string;
  statusLabel: string;
  primaryAction: WebAuthErrorAction;
  secondaryAction: WebAuthErrorAction | null;
}

const WEB_BETA_ERROR_CODES = new Set([
  "web_beta_email_missing",
  "web_beta_email_not_allowed",
]);

const SSO_ERROR_PRESENTATIONS = new Map<
  string,
  Omit<WebAuthErrorPresentation, "primaryAction" | "secondaryAction">
>([
  [
    "sso_email_domain_not_allowed",
    {
      title: "Account not allowed",
      description:
        "This SSO connection only accepts approved email domains. Sign in with an account from the configured domain or update the SSO allowlist.",
      statusLabel: "SSO access denied",
    },
  ],
  [
    "sso_email_missing",
    {
      title: "Email missing",
      description:
        "The identity provider did not return an email address. Check the provider scopes and try again.",
      statusLabel: "SSO setup issue",
    },
  ],
  [
    "sso_email_unverified",
    {
      title: "Email not verified",
      description:
        "The identity provider returned an unverified email address. Verify the email with your provider and try again.",
      statusLabel: "SSO access denied",
    },
  ],
  [
    "sso_state_invalid",
    {
      title: "Sign in expired",
      description: "This SSO sign-in attempt expired. Start again from Proliferate.",
      statusLabel: "Expired sign in",
    },
  ],
  [
    "sso_oidc_token_exchange_failed",
    {
      title: "SSO setup issue",
      description:
        "The provider accepted sign-in, but Proliferate could not exchange the callback code. Check the client secret, token auth method, and callback URL.",
      statusLabel: "Token exchange failed",
    },
  ],
  [
    "sso_oidc_identity_verification_failed",
    {
      title: "SSO setup issue",
      description:
        "Proliferate could not verify the identity token returned by the provider. Check the issuer, client ID, and provider metadata.",
      statusLabel: "Identity verification failed",
    },
  ],
  [
    "sso_oidc_nonce_mismatch",
    {
      title: "Sign in needs attention",
      description: "The provider callback did not match the SSO sign-in attempt. Try again.",
      statusLabel: "SSO verification failed",
    },
  ],
  [
    "sso_connection_disabled",
    {
      title: "SSO unavailable",
      description: "This SSO connection is disabled. Enable it or use another sign-in method.",
      statusLabel: "SSO disabled",
    },
  ],
  [
    "sso_connection_unavailable",
    {
      title: "SSO unavailable",
      description: "This SSO connection is no longer available. Check the SSO configuration.",
      statusLabel: "SSO unavailable",
    },
  ],
]);

export function isWebBetaAuthErrorCode(code: string | null): boolean {
  return code !== null && WEB_BETA_ERROR_CODES.has(code);
}

export function webBetaAuthErrorCode(error: unknown): string | null {
  const code =
    error
    && typeof error === "object"
    && "code" in error
    && typeof error.code === "string"
      ? error.code
      : null;
  return isWebBetaAuthErrorCode(code) ? code : null;
}

export function webAuthErrorPresentation(code: string | null): WebAuthErrorPresentation {
  if (isWebBetaAuthErrorCode(code)) {
    return {
      title: "No cloud account",
      description:
        "Hosted web access is currently limited to beta users. You can still use Proliferate from the desktop app.",
      statusLabel: "Beta only",
      primaryAction: { kind: "open_desktop", label: "Open Desktop" },
      secondaryAction: { kind: "try_again", label: "Try another account" },
    };
  }

  const ssoPresentation = code ? SSO_ERROR_PRESENTATIONS.get(code) : null;
  if (ssoPresentation) {
    return {
      ...ssoPresentation,
      primaryAction: { kind: "try_again", label: "Try again" },
      secondaryAction: { kind: "go_home", label: "Go to dashboard" },
    };
  }

  return {
    title: "Sign in needs attention",
    description: code
      ? `The sign-in attempt could not be completed: ${code}`
      : "The sign-in attempt could not be completed. Return to the app and try again.",
    statusLabel: "Auth error",
    primaryAction: { kind: "try_again", label: "Try again" },
    secondaryAction: { kind: "go_home", label: "Go to dashboard" },
  };
}
