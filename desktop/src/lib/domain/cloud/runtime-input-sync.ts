import type { CloudAgentKind } from "@/lib/integrations/cloud/client";

export type RuntimeInputSyncSourceKind =
  | "credential"
  | "repo_tracked_file";

export type RuntimeInputSyncStatus =
  | "not_configured"
  | "local_only"
  | "syncing"
  | "synced_to_cloud"
  | "manual_sync"
  | "sync_failed";

export type RuntimeInputSyncTrigger =
  | "preference_enabled"
  | "startup"
  | "online"
  | "hourly"
  | "retry"
  | "credential_mutation"
  | "repo_config_mutation"
  | "runtime_reconnected";

export type RuntimeInputSyncFailureKind =
  | "cloud_unavailable"
  | "missing_local_source"
  | "needs_reconnect"
  | "too_large"
  | "runtime_unavailable"
  | "request_failed";

export interface CredentialRuntimeInputSyncDescriptor {
  kind: "credential";
  provider: CloudAgentKind;
}

export interface RepoTrackedFileRuntimeInputSyncDescriptor {
  kind: "repo_tracked_file";
  gitOwner: string;
  gitRepoName: string;
  localWorkspaceId: string;
  relativePath: string;
}

export type RuntimeInputSyncDescriptor =
  | CredentialRuntimeInputSyncDescriptor
  | RepoTrackedFileRuntimeInputSyncDescriptor;

export interface RuntimeInputSyncQueueState {
  items: RuntimeInputSyncDescriptor[];
  keys: Set<string>;
}

export const MAX_RUNTIME_INPUT_SYNC_TRACKED_FILE_BYTES = 1_048_576;

export const SUPPORTED_CLOUD_CREDENTIAL_ENV_VARS: Record<string, CloudAgentKind> = {
  ANTHROPIC_API_KEY: "claude",
  GEMINI_API_KEY: "gemini",
  GOOGLE_API_KEY: "gemini",
  GOOGLE_GENAI_USE_VERTEXAI: "gemini",
};

export function credentialProviderForEnvVar(name: string): CloudAgentKind | null {
  return SUPPORTED_CLOUD_CREDENTIAL_ENV_VARS[name.trim()] ?? null;
}

export function createRuntimeInputSyncQueueState(): RuntimeInputSyncQueueState {
  return {
    items: [],
    keys: new Set(),
  };
}

export function runtimeInputSyncDescriptorKey(
  descriptor: RuntimeInputSyncDescriptor,
): string {
  switch (descriptor.kind) {
    case "credential":
      return `credential:${descriptor.provider}`;
    case "repo_tracked_file":
      return [
        "repo_tracked_file",
        descriptor.gitOwner,
        descriptor.gitRepoName,
        descriptor.localWorkspaceId,
        descriptor.relativePath,
      ].join(":");
  }
}

export function runtimeInputSyncDescriptorSourceKind(
  descriptor: RuntimeInputSyncDescriptor,
): RuntimeInputSyncSourceKind {
  return descriptor.kind;
}

export function normalizeRuntimeInputSyncDescriptor(
  descriptor: RuntimeInputSyncDescriptor,
): RuntimeInputSyncDescriptor | null {
  switch (descriptor.kind) {
    case "credential":
      return descriptor.provider === "claude"
        || descriptor.provider === "codex"
        || descriptor.provider === "gemini"
        ? descriptor
        : null;
    case "repo_tracked_file": {
      const gitOwner = descriptor.gitOwner.trim();
      const gitRepoName = descriptor.gitRepoName.trim();
      const localWorkspaceId = descriptor.localWorkspaceId.trim();
      const relativePath = descriptor.relativePath.trim().replace(/\\/g, "/");
      if (!gitOwner || !gitRepoName || !localWorkspaceId || !relativePath) {
        return null;
      }
      if (
        relativePath.startsWith("/")
        || relativePath.split("/").some((segment) => (
          !segment || segment === "." || segment === ".." || segment === ".git"
        ))
      ) {
        return null;
      }
      return {
        kind: "repo_tracked_file",
        gitOwner,
        gitRepoName,
        localWorkspaceId,
        relativePath,
      };
    }
  }
}

export function enqueueRuntimeInputSyncDescriptors(
  state: RuntimeInputSyncQueueState,
  descriptors: RuntimeInputSyncDescriptor[],
): RuntimeInputSyncQueueState {
  const next = {
    items: [...state.items],
    keys: new Set(state.keys),
  };

  for (const descriptor of descriptors) {
    const normalized = normalizeRuntimeInputSyncDescriptor(descriptor);
    if (!normalized) {
      continue;
    }
    const key = runtimeInputSyncDescriptorKey(normalized);
    if (next.keys.has(key)) {
      continue;
    }
    next.keys.add(key);
    next.items.push(normalized);
  }

  return next;
}

export function dequeueRuntimeInputSyncDescriptor(
  state: RuntimeInputSyncQueueState,
): {
  descriptor: RuntimeInputSyncDescriptor | null;
  state: RuntimeInputSyncQueueState;
} {
  const [descriptor, ...items] = state.items;
  if (!descriptor) {
    return { descriptor: null, state };
  }
  const keys = new Set(state.keys);
  keys.delete(runtimeInputSyncDescriptorKey(descriptor));
  return {
    descriptor,
    state: { items, keys },
  };
}
