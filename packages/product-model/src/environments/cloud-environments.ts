import type { SaveCloudRepoConfigRequest } from "@proliferate/cloud-sdk";
import { formatGitRepoId } from "../repos/repo-id";

const WRITE_PERMISSIONS = new Set(["admin", "maintain", "push"]);

export interface CloudEnvironmentRepoIdentity {
  gitOwner: string;
  gitRepoName: string;
}

export interface CloudEnvironmentConfigSummaryInput extends CloudEnvironmentRepoIdentity {
  configured: boolean;
  configuredAt?: string | null;
  filesVersion?: number | null;
}

export interface CloudEnvironmentSavedConfigInput {
  configured?: boolean | null;
  defaultBranch?: string | null;
  envVars?: Record<string, string> | null;
  setupScript?: string | null;
  runCommand?: string | null;
}

export interface CloudEnvironmentLocalCheckoutInput extends CloudEnvironmentRepoIdentity {
  sourceRoot: string;
  name: string;
  secondaryLabel?: string | null;
}

export type CloudEnvironmentLocalState = "cloud_only" | "local_and_cloud";
export type CloudEnvironmentConfigState = "configured" | "disabled";

export interface CloudEnvironmentListItem {
  id: string;
  gitOwner: string;
  gitRepoName: string;
  fullName: string;
  label: string;
  description: string;
  configured: boolean;
  configState: CloudEnvironmentConfigState;
  localState: CloudEnvironmentLocalState;
  localSourceRoot: string | null;
  filesVersion: number | null;
}

export interface CloudRepositoryAccessInput {
  defaultBranch?: string | null;
  permission?: string | null;
  archived?: boolean | null;
  disabled?: boolean | null;
}

export interface CoreCloudEnvironmentDraftInput {
  configured?: boolean;
  defaultBranch: string | null;
  envVars: Record<string, string>;
  setupScript: string;
  runCommand: string;
}

function normalizedRepoKey(input: CloudEnvironmentRepoIdentity): string {
  return formatGitRepoId(input).toLowerCase();
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
): SaveCloudRepoConfigRequest {
  return {
    configured: true,
    defaultBranch,
    envVars: {},
    setupScript: "",
    runCommand: "",
  };
}

export function buildReenableCloudEnvironmentConfigRequest(
  config: CloudEnvironmentSavedConfigInput,
  defaultBranch: string | null,
): SaveCloudRepoConfigRequest {
  return {
    configured: true,
    defaultBranch: config.defaultBranch ?? defaultBranch,
    envVars: config.envVars ?? {},
    setupScript: config.setupScript ?? "",
    runCommand: config.runCommand ?? "",
  };
}

export function buildCoreCloudEnvironmentSaveRequest(
  draft: CoreCloudEnvironmentDraftInput,
): SaveCloudRepoConfigRequest {
  if (draft.configured === false) {
    return {
      configured: false,
      defaultBranch: null,
      envVars: {},
      setupScript: "",
      runCommand: "",
    };
  }

  return {
    configured: true,
    defaultBranch: draft.defaultBranch,
    envVars: normalizeEnvVars(draft.envVars),
    setupScript: draft.setupScript,
    runCommand: draft.runCommand,
  };
}

export function buildCloudEnvironmentListItems(input: {
  configs: readonly CloudEnvironmentConfigSummaryInput[];
  localCheckouts?: readonly CloudEnvironmentLocalCheckoutInput[];
}): CloudEnvironmentListItem[] {
  const localByRepo = new Map<string, CloudEnvironmentLocalCheckoutInput>();
  for (const local of input.localCheckouts ?? []) {
    localByRepo.set(normalizedRepoKey(local), local);
  }

  return input.configs
    .map((config) => {
      const fullName = repoFullName(config);
      const local = localByRepo.get(normalizedRepoKey(config)) ?? null;
      return {
        id: fullName,
        gitOwner: config.gitOwner,
        gitRepoName: config.gitRepoName,
        fullName,
        label: fullName,
        description: local
          ? local.secondaryLabel || local.sourceRoot
          : "Cloud-only environment",
        configured: config.configured,
        configState: config.configured ? "configured" : "disabled",
        localState: local ? "local_and_cloud" : "cloud_only",
        localSourceRoot: local?.sourceRoot ?? null,
        filesVersion: config.filesVersion ?? null,
      } satisfies CloudEnvironmentListItem;
    })
    .sort(compareCloudEnvironmentListItems);
}

function compareCloudEnvironmentListItems(
  left: CloudEnvironmentListItem,
  right: CloudEnvironmentListItem,
): number {
  if (left.configured !== right.configured) {
    return left.configured ? -1 : 1;
  }
  if (left.localState !== right.localState) {
    return left.localState === "local_and_cloud" ? -1 : 1;
  }
  return left.fullName.localeCompare(right.fullName);
}

function normalizeEnvVars(envVars: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(envVars)
      .map(([key, value]) => [key.trim(), value] as const)
      .filter(([key]) => key.length > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}
