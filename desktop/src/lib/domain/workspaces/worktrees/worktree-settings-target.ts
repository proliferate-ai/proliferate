export type WorktreeSettingsTargetLocation = "local" | "cloud";

export interface WorktreeSettingsTarget {
  key: string;
  label: string;
  location: WorktreeSettingsTargetLocation;
  runtimeUrl: string;
  runtimeGeneration: number | null;
  environmentId: string | null;
  authToken?: string | null;
}

export function worktreeSettingsTargetIdentity(
  location: WorktreeSettingsTargetLocation,
  runtimeUrl: string,
  runtimeGeneration: number | null,
  environmentId: string | null,
): string {
  const runtimeIdentity = environmentId ?? runtimeUrl.trim();
  return runtimeGeneration === null
    ? `${location}:${runtimeIdentity}`
    : `${location}:${runtimeIdentity}:generation:${runtimeGeneration}`;
}

export function buildLocalWorktreeSettingsTarget(
  runtimeUrl: string,
): WorktreeSettingsTarget {
  const trimmedRuntimeUrl = runtimeUrl.trim();
  return {
    key: worktreeSettingsTargetIdentity("local", trimmedRuntimeUrl, 0, null),
    label: "Local runtime",
    location: "local",
    runtimeUrl: trimmedRuntimeUrl,
    runtimeGeneration: 0,
    environmentId: null,
  };
}

export function worktreeSettingsTargetRuntimeConnection(target: WorktreeSettingsTarget) {
  return {
    runtimeUrl: target.runtimeUrl,
    authToken: target.authToken,
  };
}
