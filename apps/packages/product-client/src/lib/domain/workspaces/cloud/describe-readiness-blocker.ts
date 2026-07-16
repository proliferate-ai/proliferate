import type { RepositoryReadiness } from "@proliferate/product-domain/repos/repo-readiness";
import type { CloudRepoPickerBlockerView } from "@proliferate/product-ui/repos/CloudRepoPicker";
import type { CloudRepoIdentity } from "#product/lib/domain/workspaces/cloud/cloud-repository-intent";

export interface ReadinessBlockerInputs {
  readiness: RepositoryReadiness;
  repo: CloudRepoIdentity | null;
  githubAccessDisplayName: string | null;
  orgName: string | null;
  installUrl: string;
  userAuthorization: { authorize: () => void; authorizing: boolean; error: string | null };
  installation: {
    install: () => void;
    openInstallationSettings: () => void;
    installing: boolean;
    error: string | null;
  };
  onCopyAdminRequest: () => void;
  /** Re-run the per-repo authority query (gate 4 retry). */
  onRetryAuthority: () => void;
  /**
   * Route to the product sign-in flow (gate 2). Without this the dialog is
   * explanatory but unrecoverable when a session expires mid-intent
   * (PR2-SIGNIN-04).
   */
  onSignIn: () => void;
}

/**
 * Map the first unmet gate to a single-CTA blocker, in the resolver's
 * vocabulary. Operator/human-access gates (action "none") explain and offer no
 * user-auth CTA; non-privileged members get a copy-request CTA.
 *
 * Returns null for the in-progress continuation states (gates 9 and 10): the
 * held intent continues automatically, so the host shows progress rather than a
 * blocker.
 */
export function describeReadinessBlocker(
  input: ReadinessBlockerInputs,
): CloudRepoPickerBlockerView | null {
  const { readiness } = input;
  switch (readiness.action) {
    case "none":
      return operatorOrHumanBlocker(readiness.gate, input);
    case "sign_in":
      return {
        title: "Sign in to continue",
        description: "Sign in to Proliferate to set up this repository in Cloud.",
        actionLabel: "Sign in",
        onAction: input.onSignIn,
      };
    case "authorize_user":
      return {
        title: "Connect GitHub App",
        description:
          "Authorize the Proliferate GitHub App to set up this repository in Cloud.",
        actionLabel: input.userAuthorization.authorizing ? "Opening GitHub…" : "Connect GitHub App",
        actionLoading: input.userAuthorization.authorizing,
        onAction: input.userAuthorization.authorize,
      };
    case "reauthorize_user":
      return {
        title: "Reconnect GitHub App",
        description:
          "Your GitHub App authorization expired. Reconnect it to set up this repository in Cloud.",
        actionLabel: input.userAuthorization.authorizing ? "Opening GitHub…" : "Reconnect GitHub App",
        actionLoading: input.userAuthorization.authorizing,
        onAction: input.userAuthorization.authorize,
      };
    case "install_app":
      return {
        title: "Install Proliferate GitHub App",
        description:
          "Install the Proliferate GitHub App for your organization to set up this repository in Cloud.",
        actionLabel: input.installation.installing ? "Opening GitHub…" : "Install Proliferate GitHub App",
        actionLoading: input.installation.installing,
        onAction: input.installation.install,
      };
    case "grant_repo_access":
      return {
        title: "Grant repository access",
        description:
          "Update the Proliferate GitHub App installation so it has access to this repository.",
        actionLabel: "Grant repository access",
        onAction: input.installation.openInstallationSettings,
      };
    case "copy_admin_request":
      return {
        title: "Ask an admin",
        description:
          "You don't have permission to install or grant access to the Proliferate GitHub App. Copy a request to send to an organization admin.",
        actionLabel: "Copy request",
        onAction: input.onCopyAdminRequest,
      };
    case "retry":
      return {
        title: "Couldn't check GitHub access",
        description: "GitHub App access for this repository could not be checked. Try again.",
        actionLabel: "Retry",
        onAction: input.onRetryAuthority,
      };
    case "set_up_cloud":
      // Ready to materialize; the continuation runs automatically. Show a
      // progress note rather than a blocker.
      return null;
  }
}

function operatorOrHumanBlocker(
  gate: number,
  input: ReadinessBlockerInputs,
): CloudRepoPickerBlockerView | null {
  // Gates 9 and 10 are the in-progress / ready continuation states: the held
  // intent continues automatically, so surface progress, not operator copy.
  if (gate === 9 || gate === 10) {
    return null;
  }
  // Gate 8 = human GitHub repository access (repaired on GitHub, not here).
  if (gate === 8) {
    return {
      title: "No access to this repository",
      description:
        "Your GitHub user does not have access to this repository. Ask a repository admin on GitHub to grant you access.",
      actionLabel: null,
      onAction: null,
    };
  }
  // Gate 1 (and a per-repo operator_configuration_required) = operator config.
  const appName = input.githubAccessDisplayName;
  return {
    title: "Cloud is not configured on this deployment",
    description: appName
      ? `Cloud repository access for ${appName} isn't fully configured on this deployment. An operator must finish configuring it.`
      : "Managed Cloud isn't fully configured on this deployment. An operator must finish configuring it before repositories can be set up in Cloud.",
    actionLabel: null,
    onAction: null,
  };
}
