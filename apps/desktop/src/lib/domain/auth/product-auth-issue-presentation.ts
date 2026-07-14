import type { ProductAuthIssue } from "@proliferate/product-client/host/product-host";

export function productAuthIssueMessage(issue: ProductAuthIssue | undefined): string | null {
  if (!issue) {
    return null;
  }
  switch (issue.kind) {
    case "deployment_unreachable":
      return "Could not reach this Proliferate server. Check the server address and try again.";
    case "access_denied":
      return `This account cannot access the product (${issue.code}).`;
    case "callback_failed":
      return callbackFailureMessage(issue.reason);
  }
}

function callbackFailureMessage(
  reason: Extract<ProductAuthIssue, { kind: "callback_failed" }>["reason"],
): string {
  switch (reason) {
    case "provider_error":
      return "Authentication was cancelled or rejected by the provider.";
    case "malformed_callback":
      return "Authentication returned an invalid callback. Start again.";
    case "state_mismatch":
      return "Authentication received a callback from a different sign-in attempt.";
    case "expired":
      return "Authentication expired. Start again.";
    case "exchange_failed":
      return "Authentication could not be completed. Start again.";
    case "already_consumed":
      return "This authentication callback was already handled.";
  }
}
