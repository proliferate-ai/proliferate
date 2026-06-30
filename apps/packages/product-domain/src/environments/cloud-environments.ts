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

export interface CloudEnvironmentLocalCheckoutInput {
  gitOwner?: string | null;
  gitRepoName?: string | null;
  sourceRoot: string;
  name: string;
  secondaryLabel?: string | null;
}

export type CloudEnvironmentLocationState = "local_only" | "local_and_cloud" | "cloud_only";
export type CloudEnvironmentConfigState = "configured" | "disabled";

export interface CloudEnvironmentListItem {
  id: string;
  gitOwner: string | null;
  gitRepoName: string | null;
  fullName: string;
  label: string;
  description: string;
  configured: boolean | null;
  configState: CloudEnvironmentConfigState | null;
  locationState: CloudEnvironmentLocationState;
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

function localCheckoutRepoKey(input: CloudEnvironmentLocalCheckoutInput): string | null {
  return input.gitOwner && input.gitRepoName
    ? normalizedRepoKey({
      gitOwner: input.gitOwner,
      gitRepoName: input.gitRepoName,
    })
    : null;
}

function repoFullName(input: CloudEnvironmentRepoIdentity): string {
  return formatGitRepoId(input);
}

function localCheckoutFullName(input: CloudEnvironmentLocalCheckoutInput): string {
  return input.gitOwner && input.gitRepoName
    ? repoFullName({
      gitOwner: input.gitOwner,
      gitRepoName: input.gitRepoName,
    })
    : input.name;
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
    const key = localCheckoutRepoKey(local);
    if (key) {
      localByRepo.set(key, local);
    }
  }
  const configByRepo = new Map<string, CloudEnvironmentConfigSummaryInput>();
  for (const config of input.configs) {
    configByRepo.set(normalizedRepoKey(config), config);
  }

  const localItems = (input.localCheckouts ?? []).map((local) => {
    const key = localCheckoutRepoKey(local);
    const config = key ? configByRepo.get(key) ?? null : null;
    const fullName = localCheckoutFullName(local);
    return {
      id: local.sourceRoot,
      gitOwner: local.gitOwner ?? null,
      gitRepoName: local.gitRepoName ?? null,
      fullName,
      label: fullName,
      description: local.secondaryLabel || local.sourceRoot,
      configured: config?.configured ?? null,
      configState: config ? config.configured ? "configured" : "disabled" : null,
      locationState: config ? "local_and_cloud" : "local_only",
      localSourceRoot: local.sourceRoot,
      filesVersion: config?.filesVersion ?? null,
    } satisfies CloudEnvironmentListItem;
  });

  const cloudOnlyItems = input.configs
    .flatMap((config) => {
      if (localByRepo.has(normalizedRepoKey(config))) {
        return [];
      }
      const fullName = repoFullName(config);
      return [{
        id: fullName,
        gitOwner: config.gitOwner,
        gitRepoName: config.gitRepoName,
        fullName,
        label: fullName,
        description: "Cloud-only environment",
        configured: config.configured,
        configState: config.configured ? "configured" : "disabled",
        locationState: "cloud_only",
        localSourceRoot: null,
        filesVersion: config.filesVersion ?? null,
      } satisfies CloudEnvironmentListItem];
    });

  return [...localItems, ...cloudOnlyItems]
    .sort(compareCloudEnvironmentListItems);
}

function compareCloudEnvironmentListItems(
  left: CloudEnvironmentListItem,
  right: CloudEnvironmentListItem,
): number {
  const leftLocationRank = cloudEnvironmentLocationRank(left.locationState);
  const rightLocationRank = cloudEnvironmentLocationRank(right.locationState);
  if (leftLocationRank !== rightLocationRank) {
    return leftLocationRank - rightLocationRank;
  }
  if (left.configured !== right.configured) {
    return left.configured ? -1 : 1;
  }
  return left.fullName.localeCompare(right.fullName);
}

function cloudEnvironmentLocationRank(locationState: CloudEnvironmentLocationState): number {
  switch (locationState) {
    case "local_and_cloud":
      return 0;
    case "local_only":
      return 1;
    case "cloud_only":
      return 2;
  }
}

function normalizeEnvVars(envVars: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(envVars)
      .map(([key, value]) => [key.trim(), value] as const)
      .filter(([key]) => key.length > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}
