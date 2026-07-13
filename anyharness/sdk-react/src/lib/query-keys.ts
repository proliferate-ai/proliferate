export function anyHarnessCacheScopeKey(cacheScopeKey: string | null | undefined) {
  return ["anyharness", cacheScopeKey?.trim() ?? ""] as const;
}

export function anyHarnessRuntimeKey(
  runtimeUrl: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  const normalizedRuntimeUrl = runtimeUrl?.trim() ?? "";
  return [
    ...anyHarnessCacheScopeKey(cacheScopeKey?.trim() || normalizedRuntimeUrl),
    "runtime",
    normalizedRuntimeUrl,
  ] as const;
}

export function anyHarnessWorkspaceKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [
    ...anyHarnessCacheScopeKey(cacheScopeKey),
    "workspace",
    workspaceId ?? null,
  ] as const;
}

export function anyHarnessRuntimeHealthKey(
  runtimeUrl: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl, cacheScopeKey), "health"] as const;
}

export function anyHarnessAgentsKey(
  runtimeUrl: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl, cacheScopeKey), "agents"] as const;
}

export function anyHarnessAgentLaunchOptionsKey(
  runtimeUrl: string | null | undefined,
  workspaceId?: string | null,
  cacheScopeKey?: string | null,
) {
  return [
    ...anyHarnessAgentsKey(runtimeUrl, cacheScopeKey),
    "launch-options",
    workspaceId ?? null,
  ] as const;
}

export function anyHarnessAgentLaunchOptionsPrefixKey(
  runtimeUrl: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [...anyHarnessAgentsKey(runtimeUrl, cacheScopeKey), "launch-options"] as const;
}

export function anyHarnessAgentReconcileStatusKey(
  runtimeUrl: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [...anyHarnessAgentsKey(runtimeUrl, cacheScopeKey), "reconcile-status"] as const;
}

export function anyHarnessAgentGatewayModelsKey(
  runtimeUrl: string | null | undefined,
  kind: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [...anyHarnessAgentsKey(runtimeUrl, cacheScopeKey), "gateway-models", kind ?? null] as const;
}

export function anyHarnessReconcileAgentsMutationKey(
  runtimeUrl: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [...anyHarnessAgentsKey(runtimeUrl, cacheScopeKey), "reconcile"] as const;
}

export function anyHarnessRuntimeWorkspacesKey(
  runtimeUrl: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl, cacheScopeKey), "workspaces"] as const;
}

export function anyHarnessWorkspaceRetirePreflightKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "retire", "preflight"] as const;
}

export function anyHarnessWorkspacePurgePreflightKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "purge", "preflight"] as const;
}

export function anyHarnessWorktreesInventoryKey(
  runtimeUrl: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl, cacheScopeKey), "worktrees", "inventory"] as const;
}

export function anyHarnessWorktreesRetentionPolicyKey(
  runtimeUrl: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl, cacheScopeKey), "worktrees", "retention-policy"] as const;
}

export function anyHarnessRepoRootsKey(
  runtimeUrl: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl, cacheScopeKey), "repo-roots"] as const;
}

export function anyHarnessRepoRootPullRequestsKey(
  runtimeUrl: string | null | undefined,
  repoRootId: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [...anyHarnessRepoRootsKey(runtimeUrl, cacheScopeKey), repoRootId ?? null, "pull-requests"] as const;
}

export function anyHarnessRepoRootGitBranchesKey(
  runtimeUrl: string | null | undefined,
  repoRootId: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [...anyHarnessRepoRootsKey(runtimeUrl, cacheScopeKey), repoRootId ?? null, "git-branches"] as const;
}

export function anyHarnessRepoRootDetectSetupKey(
  runtimeUrl: string | null | undefined,
  repoRootId: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [...anyHarnessRepoRootsKey(runtimeUrl, cacheScopeKey), repoRootId ?? null, "detect-setup"] as const;
}

export function anyHarnessWorkspaceMobilityKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "mobility"] as const;
}

export function anyHarnessWorkspaceMobilityPreflightKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceMobilityKey(cacheScopeKey, workspaceId), "preflight"] as const;
}

export function anyHarnessWorkspaceMobilityRuntimeStateKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceMobilityKey(cacheScopeKey, workspaceId), "runtime-state"] as const;
}

export function anyHarnessCoworkStatusKey(
  runtimeUrl: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl, cacheScopeKey), "cowork", "status"] as const;
}

export function anyHarnessCoworkThreadsKey(
  runtimeUrl: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl, cacheScopeKey), "cowork", "threads"] as const;
}

export function anyHarnessCoworkManagedWorkspacesKey(
  runtimeUrl: string | null | undefined,
  sessionId: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [
    ...anyHarnessRuntimeKey(runtimeUrl, cacheScopeKey),
    "cowork",
    "sessions",
    sessionId ?? null,
    "managed-workspaces",
  ] as const;
}

export function anyHarnessCoworkManifestKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [
    ...anyHarnessRuntimeKey(runtimeUrl, cacheScopeKey),
    "cowork",
    workspaceId ?? null,
    "manifest",
  ] as const;
}

export function anyHarnessCoworkArtifactScopeKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [...anyHarnessCoworkManifestKey(runtimeUrl, workspaceId, cacheScopeKey), "artifact"] as const;
}

export function anyHarnessCoworkArtifactKey(
  runtimeUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  artifactId: string | null | undefined,
  cacheScopeKey?: string | null,
) {
  return [
    ...anyHarnessCoworkArtifactScopeKey(runtimeUrl, workspaceId, cacheScopeKey),
    artifactId ?? null,
  ] as const;
}

export function anyHarnessWorkspaceDetailKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "detail"] as const;
}

export function anyHarnessSessionsKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "sessions"] as const;
}

export function anyHarnessSessionKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "session", sessionId ?? null] as const;
}

export function anyHarnessSessionScopeKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "session"] as const;
}

export function anyHarnessSessionLiveConfigKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
) {
  return [...anyHarnessSessionKey(cacheScopeKey, workspaceId, sessionId), "live-config"] as const;
}

export function anyHarnessSessionEventsKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
  afterSeq?: number,
  limit?: number,
  beforeSeq?: number,
  turnLimit?: number,
) {
  const scopeKey = [
    ...anyHarnessSessionKey(cacheScopeKey, workspaceId, sessionId),
    "events",
  ] as const;
  if (
    afterSeq == null
    && beforeSeq == null
    && limit == null
    && turnLimit == null
  ) {
    return scopeKey;
  }
  return [
    ...scopeKey,
    {
      afterSeq: afterSeq ?? null,
      beforeSeq: beforeSeq ?? null,
      limit: limit ?? null,
      turnLimit: turnLimit ?? null,
    },
  ] as const;
}

export function anyHarnessSessionSubagentsKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
) {
  return [...anyHarnessSessionKey(cacheScopeKey, workspaceId, sessionId), "subagents"] as const;
}

export function anyHarnessSessionReviewsKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
) {
  return [...anyHarnessSessionKey(cacheScopeKey, workspaceId, sessionId), "reviews"] as const;
}

export function anyHarnessReviewAssignmentCritiqueKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
  reviewRunId: string | null | undefined,
  assignmentId: string | null | undefined,
) {
  return [
    ...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId),
    "review-critique",
    reviewRunId ?? null,
    assignmentId ?? null,
  ] as const;
}

export function anyHarnessPlansKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "plans"] as const;
}

export function anyHarnessPlanKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
  planId: string | null | undefined,
) {
  return [...anyHarnessPlansKey(cacheScopeKey, workspaceId), planId ?? null] as const;
}

export function anyHarnessPlanDocumentKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
  planId: string | null | undefined,
  materialize = false,
) {
  return [...anyHarnessPlanKey(cacheScopeKey, workspaceId, planId), "document", materialize] as const;
}

export function anyHarnessGitStatusKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "git-status"] as const;
}

export function anyHarnessGitDiffKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
  path: string | null | undefined,
  scope: string | null | undefined = "working_tree",
  baseRef: string | null | undefined = null,
  oldPath: string | null | undefined = null,
) {
  return [
    ...anyHarnessGitDiffScopeKey(cacheScopeKey, workspaceId),
    normalizeGitDiffScope(scope),
    normalizeNullableGitArg(baseRef),
    normalizeNullableGitArg(oldPath),
    path ?? null,
  ] as const;
}

export function anyHarnessGitDiffScopeKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "git-diff"] as const;
}

export function anyHarnessGitBranchDiffFilesKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
  baseRef: string | null | undefined = null,
) {
  return [
    ...anyHarnessGitDiffScopeKey(cacheScopeKey, workspaceId),
    "branch-files",
    normalizeNullableGitArg(baseRef),
  ] as const;
}

export function anyHarnessGitBaseWorktreeDiffFilesKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
  baseRef: string | null | undefined = null,
) {
  return [
    ...anyHarnessGitDiffScopeKey(cacheScopeKey, workspaceId),
    "base-worktree-files",
    normalizeNullableGitArg(baseRef),
  ] as const;
}

function normalizeGitDiffScope(scope: string | null | undefined) {
  return scope?.trim() || "working_tree";
}

function normalizeNullableGitArg(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function anyHarnessGitBranchesKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "git-branches"] as const;
}

export function anyHarnessPullRequestKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "pull-request"] as const;
}

export function anyHarnessWorkspaceSetupStatusKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "setup-status"] as const;
}

export function anyHarnessWorkspaceDetectSetupKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "detect-setup"] as const;
}

export function anyHarnessWorkspaceFileTreeKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
  path: string,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "files", path] as const;
}

export function anyHarnessWorkspaceFilesScopeKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "files"] as const;
}

export function anyHarnessWorkspaceFileSearchScopeKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "file-search"] as const;
}

export function anyHarnessWorkspaceFileSearchKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
  query: string,
  limit: number,
) {
  return [...anyHarnessWorkspaceFileSearchScopeKey(cacheScopeKey, workspaceId), query, limit] as const;
}

export function anyHarnessWorkspaceFileKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
  path: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "file", path ?? null] as const;
}

export function anyHarnessWorkspaceFileScopeKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "file"] as const;
}

export function anyHarnessWorkspaceFileStatKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
  path: string | null | undefined,
) {
  return [...anyHarnessWorkspaceFileKey(cacheScopeKey, workspaceId, path), "stat"] as const;
}

export function anyHarnessTerminalsKey(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [...anyHarnessWorkspaceKey(cacheScopeKey, workspaceId), "terminals"] as const;
}

export function anyHarnessWorkspaceQueryKeyRoots(
  cacheScopeKey: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return [
    anyHarnessWorkspaceKey(cacheScopeKey, workspaceId),
    anyHarnessWorkspaceMobilityKey(cacheScopeKey, workspaceId),
    anyHarnessWorkspaceRetirePreflightKey(cacheScopeKey, workspaceId),
    anyHarnessWorkspacePurgePreflightKey(cacheScopeKey, workspaceId),
    anyHarnessSessionsKey(cacheScopeKey, workspaceId),
    anyHarnessSessionScopeKey(cacheScopeKey, workspaceId),
    anyHarnessPlansKey(cacheScopeKey, workspaceId),
    anyHarnessGitStatusKey(cacheScopeKey, workspaceId),
    anyHarnessGitDiffScopeKey(cacheScopeKey, workspaceId),
    anyHarnessGitBranchesKey(cacheScopeKey, workspaceId),
    anyHarnessPullRequestKey(cacheScopeKey, workspaceId),
    anyHarnessWorkspaceSetupStatusKey(cacheScopeKey, workspaceId),
    anyHarnessWorkspaceDetectSetupKey(cacheScopeKey, workspaceId),
    anyHarnessWorkspaceFilesScopeKey(cacheScopeKey, workspaceId),
    anyHarnessWorkspaceFileSearchScopeKey(cacheScopeKey, workspaceId),
    anyHarnessWorkspaceFileScopeKey(cacheScopeKey, workspaceId),
    anyHarnessTerminalsKey(cacheScopeKey, workspaceId),
  ] as const;
}
