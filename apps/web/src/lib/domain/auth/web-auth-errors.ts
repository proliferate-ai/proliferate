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
