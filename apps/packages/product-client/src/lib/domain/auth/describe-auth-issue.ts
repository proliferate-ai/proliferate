import type { ProductAuthIssue } from "@proliferate/product-client/host/product-host";

/**
 * Short, user-facing text for a {@link ProductAuthIssue}. AuthShell shows this
 * on the sign-in screen when the anonymous state is the result of a failure
 * (a stranded callback, a denied provider, an unreachable deployment) rather
 * than a fresh sign-in gate, so the failure is no longer silent.
 */
export function describeAuthIssue(issue: ProductAuthIssue): string {
  switch (issue.kind) {
    case "deployment_unreachable":
      return "Can't reach the server. Check your connection and retry.";
    case "access_denied":
      return issue.code === "web_beta_email_missing" ||
        issue.code === "web_beta_email_not_allowed"
        ? "Hosted web access is currently limited to beta users. You can still use Proliferate from the desktop app."
        : "This account isn't allowed to sign in here.";
    case "callback_failed":
      switch (issue.reason) {
        case "provider_error":
          return "The sign-in provider reported an error. Try again.";
        case "malformed_callback":
          return "The sign-in callback was missing required information. Try again.";
        case "state_mismatch":
        case "expired":
        case "already_consumed":
          return "That sign-in link expired or was already used. Try again.";
        case "exchange_failed":
          return "Sign-in could not be completed. Try again.";
      }
  }
}
