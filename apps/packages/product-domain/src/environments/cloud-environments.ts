import type {
  RepoEnvironmentMaterializationStatus,
  SaveRepoEnvironmentRequest,
} from "@proliferate/cloud-sdk";
import { formatGitRepoId } from "../repos/repo-id";

const WRITE_PERMISSIONS = new Set(["admin", "maintain", "push"]);

export interface CloudEnvironmentRepoIdentity {
  gitOwner: string;
  gitRepoName: string;
}

export interface CloudEnvironmentConfigSummaryInput extends CloudEnvironmentRepoIdentity {
  materializationStatus?: RepoEnvironmentMaterializationStatus | null;
}

export interface CloudEnvironmentSavedConfigInput {
  defaultBranch?: string | null;
  setupScript?: string | null;
  runCommand?: string | null;
}

export interface CloudEnvironmentListItem {
  id: string;
  gitOwner: string;
  gitRepoName: string;
  fullName: string;
  label: string;
  description: string;
  cloudStatus: RepoEnvironmentMaterializationStatus | null;
}

export interface CloudRepositoryAccessInput {
  defaultBranch?: string | null;
  permission?: string | null;
  archived?: boolean | null;
  disabled?: boolean | null;
}

export interface CoreCloudEnvironmentDraftInput {
  defaultBranch: string | null;
  setupScript: string;
  runCommand: string;
}

function repoFullName(input: CloudEnvironmentRepoIdentity): string {
  return formatGitRepoId(input);
}

export function hasCloudEnvironmentWritePermission(permission: string | null | undefined): boolean {
  return permission ? WRITE_PERMISSIONS.has(permission) : false;
}

export function blockedCloudRepositoryReason(repo: CloudRepositoryAccessInput): string | null {
  if (repo.disabled) {
    return "Repository is disabled on GitHub.";
  }
  if (repo.archived) {
    return "Archived repositories cannot be used for cloud environments.";
  }
  if (!repo.defaultBranch) {
    return "Repository does not have a default branch yet.";
  }
  if (!hasCloudEnvironmentWritePermission(repo.permission)) {
    return "GitHub write access is required for cloud environments.";
  }
  return null;
}

export function blockedCloudRepositoryBranchReason(repo: Omit<CloudRepositoryAccessInput, "defaultBranch">): string | null {
  if (repo.disabled) {
    return "Repository is disabled on GitHub.";
  }
  if (repo.archived) {
    return "Archived repositories cannot be used for cloud environments.";
  }
  if (!hasCloudEnvironmentWritePermission(repo.permission)) {
    return "GitHub write access is required for cloud environments.";
  }
  return null;
}

export function buildMinimalCloudEnvironmentConfigRequest(
  defaultBranch: string | null,
): SaveRepoEnvironmentRequest {
  return {
    kind: "cloud",
    gitProvider: "github",
    defaultBranch,
    setupScript: "",
    runCommand: "",
  };
}

export function buildReenableCloudEnvironmentConfigRequest(
  config: CloudEnvironmentSavedConfigInput,
  defaultBranch: string | null,
): SaveRepoEnvironmentRequest {
  return {
    kind: "cloud",
    gitProvider: "github",
    defaultBranch: config.defaultBranch ?? defaultBranch,
    setupScript: config.setupScript ?? "",
    runCommand: config.runCommand ?? "",
  };
}

export function buildCoreCloudEnvironmentSaveRequest(
  draft: CoreCloudEnvironmentDraftInput,
): SaveRepoEnvironmentRequest {
  return {
    kind: "cloud",
    gitProvider: "github",
    defaultBranch: draft.defaultBranch,
    setupScript: draft.setupScript,
    runCommand: draft.runCommand,
  };
}

export type CloudEnvironmentStatusTone =
  | "neutral"
  | "success"
  | "info"
  | "warning"
  | "destructive";

export interface CloudEnvironmentStatusPresentation {
  label: string;
  tone: CloudEnvironmentStatusTone;
}

/**
 * Save-footer status badge for a cloud environment editor: unconfigured and
 * dirty drafts outrank the saved environment's materialization state.
 */
export function cloudEnvironmentStatusPresentation({
  configured,
  dirty,
  materializationStatus,
}: {
  configured: boolean;
  dirty: boolean;
  materializationStatus: RepoEnvironmentMaterializationStatus | null;
}): CloudEnvironmentStatusPresentation {
  if (!configured) {
    return { label: "Ready to enable", tone: "warning" };
  }
  if (dirty) {
    return { label: "Unsaved changes", tone: "warning" };
  }
  switch (materializationStatus) {
    case "ready":
      return { label: "Materialized", tone: "success" };
    case "running":
      return { label: "Materializing", tone: "info" };
    case "pending":
      return { label: "Pending materialization", tone: "warning" };
    case "error":
      return { label: "Materialization failed", tone: "destructive" };
    default:
      return { label: "Saved", tone: "success" };
  }
}

export function buildCloudEnvironmentListItems(input: {
  configs: readonly CloudEnvironmentConfigSummaryInput[];
}): CloudEnvironmentListItem[] {
  return input.configs
    .map((config) => {
      const fullName = repoFullName(config);
      return {
        id: fullName,
        gitOwner: config.gitOwner,
        gitRepoName: config.gitRepoName,
        fullName,
        label: fullName,
        description: "Cloud-only environment",
        cloudStatus: config.materializationStatus ?? null,
      } satisfies CloudEnvironmentListItem;
    })
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}
