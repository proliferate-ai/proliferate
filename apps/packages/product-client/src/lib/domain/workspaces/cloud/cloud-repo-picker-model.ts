import type { CloudGitRepositorySummary } from "@proliferate/cloud-sdk";
import { blockedCloudRepositoryReason } from "#product/domain/environments/cloud-environments";
import { formatGitRepoId } from "#product/domain/repos/repo-id";
import type {
  CloudRepoPickerBlockerView,
  CloudRepoPickerRepositoryView,
  CloudRepoPickerSetupStepView,
  CloudRepoPickerWaitingView,
} from "#product/lib/domain/workspaces/cloud/cloud-repo-picker-view";

/**
 * The one GitHub setup checklist, in the order the resolver gates it:
 * authorize the identity, install for repository access, choose a repository.
 * Every blocker that stands between a user and the picker carries it, so the
 * remaining work is always countable instead of arriving one opaque screen at
 * a time.
 */
export const GITHUB_SETUP_STEP_LABELS = [
  "Authorize your GitHub identity",
  "Install for repository access",
  "Choose a repository",
] as const;

/** Fallback for callers that cannot name the host the browser returns to. */
const DEFAULT_RETURN_GUIDANCE =
  "Connect the GitHub account that can access the repository.";

export function buildGitHubAppPrerequisiteBlocker({
  organizationId,
  canManageGitHubAppInstallation,
  userAuthorizationLoading,
  userAuthorizationConnected,
  userAuthorizationNeedsReconnect,
  authorizingUser,
  installationLoading,
  installationInstalled,
  installingGitHubApp,
  onAuthorizeUser,
  onInstallGitHubApp,
  onCopyAdminRequest,
  returnSurface,
}: {
  organizationId: string | null;
  canManageGitHubAppInstallation: boolean;
  userAuthorizationLoading: boolean;
  userAuthorizationConnected: boolean;
  userAuthorizationNeedsReconnect: boolean;
  authorizingUser: boolean;
  installationLoading: boolean;
  installationInstalled: boolean;
  installingGitHubApp: boolean;
  onAuthorizeUser: () => void;
  onInstallGitHubApp: () => void;
  onCopyAdminRequest: () => void;
  returnSurface: "desktop" | "web";
}): CloudRepoPickerBlockerView | null {
  const returnGuidance = returnSurface === "desktop"
    ? "GitHub opens in your browser, then returns you to Proliferate Desktop."
    : "GitHub opens and returns you to Proliferate in this browser.";

  if (!organizationId) {
    return {
      title: "Organization required",
      description: "Cloud environments require an active organization before repositories can be added.",
      steps: [
        setupStep("Choose an organization", "Create or join an organization first.", "current"),
        setupStep(GITHUB_SETUP_STEP_LABELS[0], "Connect the GitHub account that can access the repository.", "upcoming"),
        setupStep(GITHUB_SETUP_STEP_LABELS[1], "Choose which organization repositories Proliferate can use.", "upcoming"),
        setupStep(GITHUB_SETUP_STEP_LABELS[2], "Select the repository for the cloud environment.", "upcoming"),
      ],
    };
  }

  if (userAuthorizationLoading || installationLoading) {
    return {
      title: "Checking GitHub App access",
      description: "Proliferate is checking your GitHub authorization and organization installation.",
      steps: buildGitHubSetupSteps({
        userAuthorized: userAuthorizationConnected,
        installationInstalled,
        returnGuidance,
      }),
    };
  }

  if (!userAuthorizationConnected) {
    return {
      title: userAuthorizationNeedsReconnect
        ? "Reauthorize GitHub App"
        : "Authorize GitHub App",
      description: "Authorize the Proliferate GitHub App so Cloud can use your GitHub identity for repository access.",
      steps: buildGitHubSetupSteps({
        userAuthorized: false,
        installationInstalled: false,
        returnGuidance,
      }),
      actionLabel: userAuthorizationNeedsReconnect
        ? "Reauthorize GitHub App"
        : "Authorize GitHub App",
      actionLoading: authorizingUser,
      onAction: onAuthorizeUser,
    };
  }

  if (!installationInstalled) {
    if (canManageGitHubAppInstallation) {
      return {
        title: "Install GitHub App",
        description: "Install the Proliferate GitHub App for this organization before adding Cloud environments.",
        steps: buildGitHubSetupSteps({
          userAuthorized: true,
          installationInstalled: false,
          returnGuidance,
        }),
        actionLabel: "Install GitHub App",
        actionLoading: installingGitHubApp,
        onAction: onInstallGitHubApp,
      };
    }
    return {
      title: "GitHub App installation required",
      description: "Ask an organization admin to install the Proliferate GitHub App before adding Cloud environments.",
      steps: buildGitHubSetupSteps({
        userAuthorized: true,
        installationInstalled: false,
        returnGuidance: "An organization owner or admin must choose repository access before you can continue.",
      }),
      actionLabel: "Copy admin request",
      onAction: onCopyAdminRequest,
    };
  }

  return null;
}

/**
 * The 3-step checklist with complete / current / upcoming resolved from what is
 * already known. `returnGuidance` is the host-truthful sentence about where
 * GitHub sends the user back to; callers that have no host to name (the ordered
 * readiness resolver, which is DOM- and host-free) omit it and get the generic
 * line instead.
 */
export function buildGitHubSetupSteps({
  userAuthorized,
  installationInstalled,
  canManageInstallation = true,
  returnGuidance = DEFAULT_RETURN_GUIDANCE,
}: {
  userAuthorized: boolean;
  installationInstalled: boolean;
  canManageInstallation?: boolean;
  returnGuidance?: string;
}): readonly CloudRepoPickerSetupStepView[] {
  return [
    setupStep(
      GITHUB_SETUP_STEP_LABELS[0],
      userAuthorized ? "GitHub identity authorized." : returnGuidance,
      userAuthorized ? "complete" : "current",
    ),
    setupStep(
      GITHUB_SETUP_STEP_LABELS[1],
      installationInstalled
        ? "Organization repository access installed."
        : userAuthorized
          ? (canManageInstallation
            ? returnGuidance
            : "An organization admin needs to grant access.")
          : "Choose organization repository access after authorization.",
      installationInstalled ? "complete" : userAuthorized ? "current" : "upcoming",
    ),
    setupStep(
      GITHUB_SETUP_STEP_LABELS[2],
      "Select the repository for the cloud environment.",
      userAuthorized && installationInstalled ? "current" : "upcoming",
    ),
  ];
}

/** Which checklist step the user was sent to GitHub for. */
export type GitHubWaitingStep = "authorize" | "install";

/**
 * The parked-on-GitHub panel.
 *
 * Manual re-check, not polling: the return trip can take a minute (an org
 * install is a multi-screen GitHub flow) and a spinner that silently re-queries
 * gives the user nothing to press when the answer is "not yet". "Check again"
 * re-runs exactly the refetch the authorization callback triggers.
 */
export function buildGitHubWaitingView({
  step,
  canManageInstallation,
  checking = false,
  requestText = null,
  onCheckAgain,
  onCancel,
}: {
  step: GitHubWaitingStep;
  canManageInstallation: boolean;
  checking?: boolean;
  requestText?: string | null;
  onCheckAgain: () => void;
  onCancel: () => void;
}): CloudRepoPickerWaitingView {
  if (step === "authorize") {
    return {
      title: "Finish authorizing on GitHub",
      description:
        "A browser tab opened for you to authorize the Proliferate GitHub App. Come back here when you're done.",
      requestText: null,
      checkAgainLabel: checking ? "Checking…" : "I've done this — Check again",
      checking,
      onCheckAgain,
      onCancel,
    };
  }
  if (!canManageInstallation) {
    return {
      title: "Waiting on an admin",
      description:
        "We copied a request to your clipboard. Send it to an organization admin — access will be ready once they finish installing the app.",
      requestText: requestText ?? cloudEnvironmentAdminRequestCopy(),
      checkAgainLabel: checking ? "Checking…" : "Check again",
      checking,
      onCheckAgain,
      onCancel,
    };
  }
  return {
    title: "Finish installing on GitHub",
    description: "Choose which repositories Proliferate can access, then come back here.",
    requestText: null,
    checkAgainLabel: checking ? "Checking…" : "I've done this — Check again",
    checking,
    onCheckAgain,
    onCancel,
  };
}

function setupStep(
  label: string,
  description: string,
  status: CloudRepoPickerSetupStepView["status"],
): CloudRepoPickerSetupStepView {
  return { label, description, status };
}

export function mergeRepositories(
  current: readonly CloudGitRepositorySummary[],
  incoming: readonly CloudGitRepositorySummary[],
): CloudGitRepositorySummary[] {
  const byId = new Map<string, CloudGitRepositorySummary>();
  for (const repo of current) {
    byId.set(formatGitRepoId(repo), repo);
  }
  for (const repo of incoming) {
    byId.set(formatGitRepoId(repo), repo);
  }
  return Array.from(byId.values());
}

export function projectCloudRepoPickerRepositories(
  repositories: readonly CloudGitRepositorySummary[],
): CloudRepoPickerRepositoryView[] {
  return repositories.map((repo) => ({
    id: formatGitRepoId(repo),
    fullName: repo.fullName,
    defaultBranch: repo.defaultBranch,
    private: repo.private,
    fork: repo.fork,
    archived: repo.archived,
    disabled: repo.disabled,
    permission: repo.permission ?? null,
    configured: repo.configured,
    repoConfigState: repo.repoConfigState,
    ownerAvatarUrl: repo.ownerAvatarUrl,
    pushedAt: repo.pushedAt,
    updatedAt: repo.updatedAt,
    disabledReason: blockedCloudRepositoryReason(repo),
  }));
}

export function repoAuthorityMessage(status: string): string {
  switch (status) {
    case "missing_user_authorization":
      return "Authorize the Proliferate GitHub App in Account settings before adding this cloud environment.";
    case "expired_user_authorization":
      return "Reauthorize the Proliferate GitHub App in Account settings before adding this cloud environment.";
    case "missing_installation":
      return "An organization admin needs to install the Proliferate GitHub App for this repository.";
    case "repo_not_covered":
      return "Update the Proliferate GitHub App installation so it has access to this repository.";
    case "missing_user_repo_access":
      return "Your GitHub user does not have access to this repository.";
    default:
      return "GitHub App repository access is not ready for this repository.";
  }
}

export function githubSetupReturnSurface(
  userAuthorizationReturnTo: string | null,
  installationReturnTo: string | null,
): "desktop" | "web" {
  const returnTargets = [userAuthorizationReturnTo, installationReturnTo].filter(Boolean);
  return returnTargets.some((target) => target?.startsWith("proliferate"))
    ? "desktop"
    : "web";
}

export function cloudEnvironmentAdminRequestCopy(): string {
  return [
    "Please install the Proliferate GitHub App for our organization",
    "so we can add Cloud environments.",
  ].join(" ");
}
