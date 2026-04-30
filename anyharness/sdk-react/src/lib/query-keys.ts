export function anyHarnessRuntimeKey(runtimeUrl: string | null | undefined) {
  return ["anyharness", runtimeUrl?.trim() ?? ""] as const;
}

export function anyHarnessRuntimeHealthKey(runtimeUrl: string | null | undefined) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "health"] as const;
}

export function anyHarnessAgentsKey(runtimeUrl: string | null | undefined) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "agents"] as const;
}

export function anyHarnessAgentReconcileStatusKey(
  runtimeUrl: string | null | undefined,
) {
  return [...anyHarnessAgentsKey(runtimeUrl), "reconcile-status"] as const;
}

export function anyHarnessReconcileAgentsMutationKey(
  runtimeUrl: string | null | undefined,
) {
  return [...anyHarnessAgentsKey(runtimeUrl), "reconcile"] as const;
}

export function anyHarnessProviderConfigsKey(runtimeUrl: string | null | undefined) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "provider-configs"] as const;
}

export function anyHarnessModelRegistriesKey(runtimeUrl: string | null | undefined) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "model-registries"] as const;
}

export function anyHarnessModelRegistryKey(
  runtimeUrl: string | null | undefined,
  kind: string | null | undefined,
) {
  return [...anyHarnessModelRegistriesKey(runtimeUrl), kind ?? null] as const;
}

export function anyHarnessRuntimeWorkspacesKey(runtimeUrl: string | null | undefined) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "workspaces"] as const;
}

export function anyHarnessRepoRootsKey(runtimeUrl: string | null | undefined) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "repo-roots"] as const;
}

export function anyHarnessRepoRootGitBranchesKey(
  runtimeUrl: string | null | undefined,
  repoRootId: string | null | undefined,
) {
  return [...anyHarnessRepoRootsKey(runtimeUrl), repoRootId ?? null, "git-branches"] as const;
}

export function anyHarnessRepoRootDetectSetupKey(
  runtimeUrl: string | null | undefined,
  repoRootId: string | null | undefined,
) {
  return [...anyHarnessRepoRootsKey(runtimeUrl), repoRootId ?? null, "detect-setup"] as const;
}

export function anyHarnessWorkspaceMobilityKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "mobility", workspaceId ?? null] as const;
}

export function anyHarnessWorkspaceMobilityPreflightKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceMobilityKey(runtimeUrl, workspaceId), "preflight"] as const;
}

export function anyHarnessWorkspaceMobilityRuntimeStateKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceMobilityKey(runtimeUrl, workspaceId), "runtime-state"] as const;
}

export function anyHarnessCoworkStatusKey(runtimeUrl: string | null | undefined) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "cowork", "status"] as const;
}

export function anyHarnessCoworkThreadsKey(runtimeUrl: string | null | undefined) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "cowork", "threads"] as const;
}

export function anyHarnessCoworkManagedWorkspacesKey(
  runtimeUrl: string | null | undefined,
  sessionId: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "cowork", "sessions", sessionId ?? null, "managed-workspaces"] as const;
}

export function anyHarnessCoworkManifestKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "cowork", workspaceId ?? null, "manifest"] as const;
}

export function anyHarnessCoworkArtifactScopeKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessCoworkManifestKey(runtimeUrl, workspaceId), "artifact"] as const;
}

export function anyHarnessCoworkArtifactKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  artifactId: string | null | undefined,
) {
  return [...anyHarnessCoworkArtifactScopeKey(runtimeUrl, workspaceId), artifactId ?? null] as const;
}

export function anyHarnessWorkspaceSessionLaunchKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "workspace-session-launch", workspaceId ?? null] as const;
}

export function anyHarnessSessionsKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "sessions", workspaceId ?? null] as const;
}

export function anyHarnessSessionKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "session", workspaceId ?? null, sessionId ?? null] as const;
}

export function anyHarnessSessionScopeKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "session", workspaceId ?? null] as const;
}

export function anyHarnessSessionLiveConfigKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
) {
  return [...anyHarnessSessionKey(runtimeUrl, workspaceId, sessionId), "live-config"] as const;
}

export function anyHarnessSessionEventsKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
  afterSeq?: number,
) {
  return [...anyHarnessSessionKey(runtimeUrl, workspaceId, sessionId), "events", afterSeq ?? null] as const;
}

export function anyHarnessSessionSubagentsKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
) {
  return [...anyHarnessSessionKey(runtimeUrl, workspaceId, sessionId), "subagents"] as const;
}

export function anyHarnessSessionReviewsKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
) {
  return [...anyHarnessSessionKey(runtimeUrl, workspaceId, sessionId), "reviews"] as const;
}

export function anyHarnessReviewAssignmentCritiqueKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  reviewRunId: string | null | undefined,
  assignmentId: string | null | undefined,
) {
  return [
    ...anyHarnessRuntimeKey(runtimeUrl),
    "review-critique",
    workspaceId ?? null,
    reviewRunId ?? null,
    assignmentId ?? null,
  ] as const;
}

export function anyHarnessPlansKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "plans", workspaceId ?? null] as const;
}

export function anyHarnessPlanKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  planId: string | null | undefined,
) {
  return [...anyHarnessPlansKey(runtimeUrl, workspaceId), planId ?? null] as const;
}

export function anyHarnessPlanDocumentKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  planId: string | null | undefined,
  materialize = false,
) {
  return [...anyHarnessPlanKey(runtimeUrl, workspaceId, planId), "document", materialize] as const;
}

export function anyHarnessGitStatusKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "git-status", workspaceId ?? null] as const;
}

export function anyHarnessGitDiffKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  path: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "git-diff", workspaceId ?? null, path ?? null] as const;
}

export function anyHarnessGitDiffScopeKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "git-diff", workspaceId ?? null] as const;
}

export function anyHarnessGitBranchesKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "git-branches", workspaceId ?? null] as const;
}

export function anyHarnessPullRequestKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "pull-request", workspaceId ?? null] as const;
}

export function anyHarnessWorkspaceSetupStatusKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "workspace-setup-status", workspaceId ?? null] as const;
}

export function anyHarnessWorkspaceDetectSetupKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "workspace-detect-setup", workspaceId ?? null] as const;
}

export function anyHarnessWorkspaceFileTreeKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  path: string,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "files", workspaceId ?? null, path] as const;
}

export function anyHarnessWorkspaceFilesScopeKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "files", workspaceId ?? null] as const;
}

export function anyHarnessWorkspaceFileSearchScopeKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "file-search", workspaceId ?? null] as const;
}

export function anyHarnessWorkspaceFileSearchKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  query: string,
  limit: number,
) {
  return [...anyHarnessWorkspaceFileSearchScopeKey(runtimeUrl, workspaceId), query, limit] as const;
}

export function anyHarnessWorkspaceFileKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  path: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "file", workspaceId ?? null, path ?? null] as const;
}

export function anyHarnessWorkspaceFileScopeKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "file", workspaceId ?? null] as const;
}

export function anyHarnessWorkspaceFileStatKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  path: string | null | undefined,
) {
  return [...anyHarnessWorkspaceFileKey(runtimeUrl, workspaceId, path), "stat"] as const;
}

export function anyHarnessTerminalsKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl), "terminals", workspaceId ?? null] as const;
}

export function anyHarnessWorkspaceQueryKeyRoots(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [
    anyHarnessWorkspaceMobilityKey(runtimeUrl, workspaceId),
    anyHarnessCoworkManifestKey(runtimeUrl, workspaceId),
    anyHarnessCoworkArtifactScopeKey(runtimeUrl, workspaceId),
    anyHarnessWorkspaceSessionLaunchKey(runtimeUrl, workspaceId),
    anyHarnessSessionsKey(runtimeUrl, workspaceId),
    anyHarnessSessionScopeKey(runtimeUrl, workspaceId),
    anyHarnessPlansKey(runtimeUrl, workspaceId),
    anyHarnessGitStatusKey(runtimeUrl, workspaceId),
    anyHarnessGitDiffScopeKey(runtimeUrl, workspaceId),
    anyHarnessGitBranchesKey(runtimeUrl, workspaceId),
    anyHarnessPullRequestKey(runtimeUrl, workspaceId),
    anyHarnessWorkspaceSetupStatusKey(runtimeUrl, workspaceId),
    anyHarnessWorkspaceDetectSetupKey(runtimeUrl, workspaceId),
    anyHarnessWorkspaceFilesScopeKey(runtimeUrl, workspaceId),
    anyHarnessWorkspaceFileSearchScopeKey(runtimeUrl, workspaceId),
    anyHarnessWorkspaceFileScopeKey(runtimeUrl, workspaceId),
    anyHarnessTerminalsKey(runtimeUrl, workspaceId),
  ] as const;
}
