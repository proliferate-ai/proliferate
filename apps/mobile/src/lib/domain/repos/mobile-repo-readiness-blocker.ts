/**
 * Pure mapping from the shared repository-readiness result to a native mobile
 * blocker view model. No React, no platform APIs — the modal renders this
 * directly and wires the action id to a callback.
 *
 * Same vocabulary and first-unmet-gate semantics as Desktop/Web
 * (`CloudRepoActionDialogHost` / `buildGitHubAppPrerequisiteBlocker`), adapted
 * to a single React Native CTA. Operator (gate 1) and human-access (gate 8)
 * states offer NO impossible auth CTA; a member who cannot install/grant gets
 * an admin-request action instead of a broken browser handoff.
 */

import type {
  CloudRepoReadinessAction,
  RepositoryReadiness,
} from "@proliferate/product-domain/repos/repo-readiness";

/** What the modal should do when the CTA is pressed. `none` renders no button. */
export type MobileRepoReadinessActionKind =
  | "none"
  | "retry"
  | "authorize_user"
  | "reauthorize_user"
  | "install_app"
  | "grant_repo_access"
  | "copy_admin_request";

export interface MobileRepoReadinessBlocker {
  title: string;
  description: string;
  /** The action the CTA performs; `none` means explanatory-only, no button. */
  actionKind: MobileRepoReadinessActionKind;
  /** CTA label, or null when there is no actionable repair here. */
  actionLabel: string | null;
  /** True while the current gate is still resolving (loading), no CTA. */
  pending: boolean;
}

export interface MobileRepoReadinessBlockerInput {
  readiness: RepositoryReadiness;
  /** App/instance display name for GitHub repository access, when known. */
  githubAccessDisplayName: string | null;
  /** Whether the browser action for the current step is in flight. */
  actionBusy?: boolean;
  /**
   * Whether an upstream prerequisite query (server capabilities, user
   * authorization, installation) is still loading. While true, `readiness`
   * may already report a fail-closed gate (e.g. managed Cloud defaulted to
   * "disabled" before `/meta` resolves) — that is presentation state, not a
   * real blocker, so it takes priority over the resolved gate to avoid
   * flashing "not configured" on a fully-configured deployment.
   */
  checking?: boolean;
}

const NO_ACTION_KINDS: ReadonlySet<CloudRepoReadinessAction> = new Set([
  "none",
  "sign_in",
  "set_up_cloud",
]);

/**
 * Resolve the single blocker the mobile Add Repository / Cloud creation surface
 * should present, or `null` when every gate is met (ready to list / save).
 *
 * `sign_in` (gate 2) and `set_up_cloud` (gate 9) return `null`: mobile is only
 * reachable when signed in, and Cloud-environment setup is the normal continue
 * point (mobile saves the environment as part of the pick, no separate CTA).
 */
export function resolveMobileRepoReadinessBlocker(
  input: MobileRepoReadinessBlockerInput,
): MobileRepoReadinessBlocker | null {
  const { readiness } = input;

  // While a prerequisite query is still loading, the resolved gate may be a
  // fail-closed default (e.g. managed Cloud read as "disabled" before `/meta`
  // returns) rather than a real blocker. Surface a checking state instead of
  // whatever the resolver produced from placeholder inputs.
  if (input.checking) {
    return {
      title: "Checking Cloud access",
      description: "Proliferate is checking Cloud access for this deployment.",
      actionKind: "none",
      actionLabel: null,
      pending: true,
    };
  }

  // Ready (gate 10) or the continue-point (gate 9 set_up_cloud) / sign-in are
  // not blockers on mobile.
  if (readiness.gate >= 9 || NO_ACTION_KINDS.has(readiness.action)) {
    if (readiness.action === "none") {
      return operatorOrHumanBlocker(readiness.gate, input);
    }
    return null;
  }

  switch (readiness.action) {
    case "retry":
      return {
        title: "Couldn't check GitHub access",
        description:
          "GitHub App access for this repository could not be checked. Pull to refresh or try again.",
        actionKind: "retry",
        actionLabel: "Retry",
        pending: false,
      };
    case "authorize_user":
      return {
        title: "Connect GitHub App",
        description:
          "Authorize the Proliferate GitHub App to set up repositories in Cloud. GitHub opens in your browser and returns you here.",
        actionKind: "authorize_user",
        actionLabel: input.actionBusy ? "Opening GitHub…" : "Connect GitHub App",
        pending: Boolean(input.actionBusy),
      };
    case "reauthorize_user":
      return {
        title: "Reconnect GitHub App",
        description:
          "Your GitHub App authorization expired. Reconnect it to set up repositories in Cloud.",
        actionKind: "reauthorize_user",
        actionLabel: input.actionBusy ? "Opening GitHub…" : "Reconnect GitHub App",
        pending: Boolean(input.actionBusy),
      };
    case "install_app":
      return {
        title: "Install Proliferate GitHub App",
        description:
          "Install the Proliferate GitHub App for your organization to set up repositories in Cloud.",
        actionKind: "install_app",
        actionLabel: input.actionBusy ? "Opening GitHub…" : "Install GitHub App",
        pending: Boolean(input.actionBusy),
      };
    case "grant_repo_access":
      return {
        title: "Grant repository access",
        description:
          "Update the Proliferate GitHub App installation so it can access this repository.",
        actionKind: "grant_repo_access",
        actionLabel: input.actionBusy ? "Opening GitHub…" : "Grant repository access",
        pending: Boolean(input.actionBusy),
      };
    case "copy_admin_request":
      return {
        title: "Ask an admin",
        description:
          "You don't have permission to install or grant access to the Proliferate GitHub App. Copy a request to send to an organization admin.",
        actionKind: "copy_admin_request",
        actionLabel: "Copy request",
        pending: false,
      };
    // `sign_in` / `set_up_cloud` handled above; exhaustive fallthrough.
    case "none":
    case "sign_in":
    case "set_up_cloud":
      return null;
  }
}

/**
 * Gate 1 (operator configuration) and gate 8 (human GitHub repo access) both
 * resolve to action `none` — neither the user nor this client can repair them,
 * so no browser CTA is offered. Copy names the instance when available.
 */
function operatorOrHumanBlocker(
  gate: number,
  input: MobileRepoReadinessBlockerInput,
): MobileRepoReadinessBlocker {
  if (gate === 8) {
    return {
      title: "No access to this repository",
      description:
        "Your GitHub user does not have access to this repository. Ask a repository admin on GitHub to grant you access.",
      actionKind: "none",
      actionLabel: null,
      pending: false,
    };
  }
  if (gate === 4) {
    // Authority query still loading (action `none` before a result arrives).
    return {
      title: "Checking GitHub access",
      description: "Proliferate is checking GitHub App access for this repository.",
      actionKind: "none",
      actionLabel: null,
      pending: true,
    };
  }
  const appName = input.githubAccessDisplayName;
  return {
    title: "Cloud is not configured on this deployment",
    description: appName
      ? `Cloud repository access for ${appName} isn't fully configured on this deployment. An operator must finish configuring it.`
      : "Managed Cloud isn't fully configured on this deployment. An operator must finish configuring it before repositories can be set up in Cloud.",
    actionKind: "none",
    actionLabel: null,
    pending: false,
  };
}

/**
 * Copy for the admin-request clipboard action, mirroring the desktop message.
 */
export function buildMobileCloudAdminRequestMessage(
  repoLabel: string | null,
): string {
  const repoClause = repoLabel ? ` so we can set up ${repoLabel} in Cloud` : " so we can add Cloud repositories";
  return [
    "Please install the Proliferate GitHub App for our organization",
    `and grant it repository access${repoClause}.`,
  ].join(" ");
}
