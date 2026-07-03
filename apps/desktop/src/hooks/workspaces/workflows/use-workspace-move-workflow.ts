import type { GitStatusSnapshot, RepoRoot, WorkspaceKind, WorkspaceMobilityArchive } from "@anyharness/sdk";
import { useGitStatusQuery } from "@anyharness/sdk-react";
import type { StartWorkspaceMoveRequest, WorkspaceMoveResponse } from "@proliferate/cloud-sdk";
import { useRepositories } from "@proliferate/cloud-sdk-react";
import { useCallback, useMemo, useState } from "react";
import {
  useStartWorkspaceMove,
  WORKSPACE_MOVE_CLOUD_WORKSPACE_EXISTS_ERROR_CODE,
} from "@/hooks/access/cloud/workspace-moves/use-start-workspace-move-mutation";
import { useWorkspaceMovePhaseMutations } from "@/hooks/access/cloud/workspace-moves/use-workspace-move-phase-mutations";
import { useWorkspaceMove } from "@/hooks/access/cloud/workspace-moves/use-workspace-move";
import { useWorkspaceMobilityPreflightQuery } from "@/hooks/access/anyharness/mobility/use-workspace-mobility-preflight-query";
import { useCloudWorkspaceActions } from "@/hooks/cloud/workflows/use-cloud-workspace-actions";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useWorkspaceCollectionsInvalidation } from "@/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { usePostMoveNavigation } from "@/hooks/workspaces/workflows/use-post-move-navigation";
import { useWorkspacePublishWorkflow } from "@/hooks/workspaces/workflows/use-workspace-publish-workflow";
import { getDesktopInstallId } from "@/lib/access/tauri/desktop-install-id";
import {
  destroyWorkspaceMobilitySource,
  exportWorkspaceMobilityArchive,
  freezeWorkspaceForHandoff,
  installWorkspaceMobilityArchive,
  markWorkspaceRemoteOwned,
  prepareWorkspaceMobilityDestination,
  unfreezeWorkspace,
} from "@/lib/access/anyharness/mobility";
import {
  resolveLocalAnyHarnessConnection,
  resolveWorkspaceConnection,
} from "@/lib/access/anyharness/resolve-workspace-connection";
import { cloudWorkspaceGroupKey, repoRootGroupKey } from "@/lib/domain/workspaces/cloud/collections";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import {
  findLocalMoveDestinationCandidateWorkspace,
  resolveLocalMoveDestinationPlan,
  type LocalMoveDestinationPlan,
} from "@/lib/domain/workspaces/move/move-destination";
import {
  isMovePostCutover,
  isNonTerminalMovePhase,
  resolveHandoffMoveId,
  resolveMoveDirection,
  type MoveDirection,
  type MovePhase,
  type MoveReadiness,
} from "@/lib/domain/workspaces/move/move-model";
import { resolveMoveReadiness, type MoveDestinationState } from "@/lib/domain/workspaces/move/move-readiness";
import {
  buildCloudToLocalMoveStartRequest,
  buildLocalToCloudMoveStartRequest,
  findCollidingCloudWorkspace,
  resolveRepoConfigIdForGitIdentity,
  resolveRepoConfigIdForRepoRoot,
} from "@/lib/domain/workspaces/move/move-start";
import {
  runWorkspaceMoveWorkflow,
  type WorkspaceMoveWorkflowDeps,
} from "@/lib/workflows/workspaces/run-workspace-move-workflow";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { rememberActiveWorkspaceMoveId, useWorkspaceMoveStore } from "@/stores/workspaces/workspace-move-store";

export interface UseWorkspaceMoveWorkflowOptions {
  workspaceId: string | null;
  /** Local-only (AnyHarness engine) workspace kind -- meaningful, and required to
   *  actually start/resume a move, only for `local_to_cloud`; ignored for
   *  `cloud_to_local` (a cloud workspace's source-fate cleanup is server-driven, spec
   *  section 2.3 mirror step 4). */
  workspaceKind: WorkspaceKind | null;
  repoRoot: Pick<RepoRoot, "remoteOwner" | "remoteRepoName" | "defaultBranch"> | null | undefined;
  enabled: boolean;
}

export type MoveWorkflowStage =
  | { kind: "loading" }
  | { kind: "not_configured" }
  | { kind: "resume"; move: WorkspaceMoveResponse; postCutover: boolean }
  | {
    kind: "collision";
    gitOwner: string;
    gitRepoName: string;
    branch: string;
    collidingWorkspaceId: string | null;
  }
  | { kind: "readiness"; readiness: MoveReadiness }
  | { kind: "progress"; phase: MovePhase | "running" }
  | { kind: "done" };

interface CollisionState {
  gitOwner: string;
  gitRepoName: string;
  branch: string;
}

function refString(ref: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = ref?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

// React wiring for both workspace_move sagas (spec section 2.3/5.4): composes the
// publish-prep machinery (git-status-driven stage/commit/push, reused wholesale --
// `initialIntent: "publish"` is exactly the git-prep step for either direction, and
// already routes to the sandbox for a cloud source via `resolveRuntimeTargetForWorkspace`
// -- spec section 5.4) with the pure readiness resolver and the pure
// `runWorkspaceMoveWorkflow` sequencer. Owns the one thing those pure layers can't:
// resolving live AnyHarness/cloud connections, the cloud->local mirror's local
// destination (re-adopt-or-prepare, spec section 2.3 mirror step 3), and driving React
// Query mutations. `direction` (spec section 2.6, "Direction inference at the entry
// points") is resolved once from `workspaceId`'s own id shape -- a cloud synthetic id
// is always a `cloud_to_local` move -- and threaded through everything below it.
export function useWorkspaceMoveWorkflow({
  workspaceId,
  workspaceKind,
  repoRoot,
  enabled,
}: UseWorkspaceMoveWorkflowOptions) {
  const direction = resolveMoveDirection(workspaceId);
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const storedMoveId = useWorkspaceMoveStore((state) =>
    workspaceId ? state.activeMoveIdByWorkspaceId[workspaceId] ?? null : null);

  const gitStatusQuery = useGitStatusQuery({ workspaceId, enabled });
  const preflightQuery = useWorkspaceMobilityPreflightQuery(workspaceId, { enabled });
  const repositoriesQuery = useRepositories(enabled);
  const { data: workspaceCollections } = useWorkspaces({ enabled });

  // Falls back to the source's own frozen runtime-state when this app session never
  // learned the move id (or forgot it across a restart) -- see resolveHandoffMoveId's
  // docstring and the locked "resume/abandon" decision: reopening the dialog after
  // Desktop was killed mid-move must still offer resume/abandon, not silently drop
  // into a fresh "readiness" check against a still-frozen source.
  const trackedMoveId = storedMoveId ?? resolveHandoffMoveId(preflightQuery.data?.runtimeState);

  const [runningPhase, setRunningPhase] = useState<MovePhase | "running" | null>(null);
  const activeMoveQuery = useWorkspaceMove(trackedMoveId, {
    enabled: enabled && trackedMoveId !== null && runningPhase === null,
  });
  const invalidateWorkspaceCollections = useWorkspaceCollectionsInvalidation(runtimeUrl);

  const publish = useWorkspacePublishWorkflow({
    workspaceId,
    initialIntent: "publish",
    runtimeBlockedReason: null,
    repoDefaultBranch: repoRoot?.defaultBranch ?? null,
    enabled,
  });

  const startMoveMutation = useStartWorkspaceMove();
  const phaseMutations = useWorkspaceMovePhaseMutations();
  const { archiveCloudWorkspace, isArchivingCloudWorkspace } = useCloudWorkspaceActions();

  const [error, setError] = useState<string | null>(null);
  const [collision, setCollision] = useState<CollisionState | null>(null);
  const [done, setDone] = useState(false);

  // --- cloud->local mirror: local destination (re-adopt-or-prepare, spec section 2.3
  // mirror step 3) -- derived purely from already-fetched collections + one extra
  // preflight call on the re-adopt candidate, if any. No-ops (all null) for
  // local_to_cloud.

  const cloudWorkspaceEntry = useMemo(() => {
    if (direction !== "cloud_to_local" || !workspaceId) return null;
    const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
    if (!cloudWorkspaceId) return null;
    return workspaceCollections?.cloudWorkspaces.find((entry) => entry.id === cloudWorkspaceId) ?? null;
  }, [direction, workspaceId, workspaceCollections?.cloudWorkspaces]);

  const localRepoRoot = useMemo(() => {
    if (!cloudWorkspaceEntry) return null;
    return workspaceCollections?.repoRoots.find(
      (candidate) => repoRootGroupKey(candidate) === cloudWorkspaceGroupKey(cloudWorkspaceEntry),
    ) ?? null;
  }, [cloudWorkspaceEntry, workspaceCollections?.repoRoots]);

  const mirrorBranch = gitStatusQuery.data?.currentBranch ?? cloudWorkspaceEntry?.repo.branch ?? null;

  const destinationCandidate = useMemo(
    () => findLocalMoveDestinationCandidateWorkspace(
      (workspaceCollections?.localWorkspaces ?? []).map((workspace) => ({
        workspaceId: workspace.id,
        repoRootId: workspace.repoRootId,
        currentBranch: workspace.currentBranch ?? null,
      })),
      localRepoRoot?.id ?? null,
      mirrorBranch,
    ),
    [workspaceCollections?.localWorkspaces, localRepoRoot?.id, mirrorBranch],
  );

  const destinationCandidatePreflightQuery = useWorkspaceMobilityPreflightQuery(
    destinationCandidate?.workspaceId ?? null,
    { enabled: enabled && direction === "cloud_to_local" && destinationCandidate !== null },
  );

  const destinationPlan: LocalMoveDestinationPlan | null = useMemo(() => {
    if (direction !== "cloud_to_local") return null;
    if (destinationCandidate && destinationCandidatePreflightQuery.isLoading) return null;
    return resolveLocalMoveDestinationPlan(
      destinationCandidate
        ? {
          workspaceId: destinationCandidate.workspaceId,
          runtimeStateMode: destinationCandidatePreflightQuery.data?.runtimeState.mode ?? null,
        }
        : null,
    );
  }, [direction, destinationCandidate, destinationCandidatePreflightQuery.isLoading, destinationCandidatePreflightQuery.data]);

  const destinationState: MoveDestinationState | null = useMemo(() => {
    if (direction !== "cloud_to_local") return null;
    if (destinationCandidate && destinationCandidatePreflightQuery.isLoading) {
      return {
        ready: false,
        blockerCode: "status_loading",
        blockerMessage: "Checking whether this workspace already exists locally…",
      };
    }
    if (destinationPlan?.mode === "re_adopt") {
      return { ready: true, blockerCode: "", blockerMessage: "" };
    }
    if (!localRepoRoot) {
      return {
        ready: false,
        blockerCode: "local_repo_not_found",
        blockerMessage: "Clone this repository locally before moving this workspace here.",
      };
    }
    return { ready: true, blockerCode: "", blockerMessage: "" };
  }, [direction, destinationCandidate, destinationCandidatePreflightQuery.isLoading, destinationPlan, localRepoRoot]);

  const repoConfigId = useMemo(() => {
    if (direction === "cloud_to_local") {
      return resolveRepoConfigIdForGitIdentity(
        { gitOwner: cloudWorkspaceEntry?.repo.owner, gitRepoName: cloudWorkspaceEntry?.repo.name },
        repositoriesQuery.data?.repositories ?? [],
      );
    }
    return resolveRepoConfigIdForRepoRoot(repoRoot, repositoriesQuery.data?.repositories ?? []);
  }, [direction, cloudWorkspaceEntry, repoRoot, repositoriesQuery.data?.repositories]);

  const activeMove = activeMoveQuery.data && isNonTerminalMovePhase(activeMoveQuery.data.phase)
    ? activeMoveQuery.data
    : null;

  const readiness = useMemo(
    () => resolveMoveReadiness({
      gitStatus: gitStatusQuery.data ?? null,
      sourcePreflight: preflightQuery.data ?? null,
      destinationState,
      activeMove,
      direction: direction ?? undefined,
    }),
    [activeMove, gitStatusQuery.data, preflightQuery.data, destinationState, direction],
  );

  const stage: MoveWorkflowStage = useMemo(() => {
    if (!workspaceId) return { kind: "loading" };
    if (done) return { kind: "done" };
    if (runningPhase !== null) return { kind: "progress", phase: runningPhase };
    if (collision) {
      const collidingWorkspace = workspaceCollections
        ? findCollidingCloudWorkspace({ cloudWorkspaces: workspaceCollections.cloudWorkspaces, ...collision })
        : null;
      return { ...collision, kind: "collision", collidingWorkspaceId: collidingWorkspace?.id ?? null };
    }
    if (trackedMoveId && activeMoveQuery.isLoading) return { kind: "loading" };
    if (activeMove) {
      return { kind: "resume", move: activeMove, postCutover: isMovePostCutover(activeMove.phase) };
    }
    if (repositoriesQuery.isLoading) return { kind: "loading" };
    if (!repoConfigId) return { kind: "not_configured" };
    return { kind: "readiness", readiness };
  }, [
    activeMove,
    activeMoveQuery.isLoading,
    collision,
    done,
    readiness,
    repoConfigId,
    repositoriesQuery.isLoading,
    runningPhase,
    trackedMoveId,
    workspaceCollections,
    workspaceId,
  ]);

  const buildDeps = useCallback((status: GitStatusSnapshot): WorkspaceMoveWorkflowDeps => ({
    startMove: async (request) => {
      const move = await startMoveMutation.mutateAsync(request);
      if (workspaceId) rememberActiveWorkspaceMoveId(workspaceId, move.id);
      return move;
    },
    freezeSource: async (moveId) => {
      const connection = await resolveWorkspaceConnection(runtimeUrl, workspaceId!);
      await freezeWorkspaceForHandoff(connection, connection.anyharnessWorkspaceId, moveId);
    },
    exportSourceArchive: async (moveId) => {
      if (direction === "cloud_to_local") {
        const response = await phaseMutations.export.mutateAsync(moveId);
        // The server's archive field is an opaque JSON blob (spec section 5.2's
        // `dict[str, object]`) -- its concrete shape is defined by the AnyHarness
        // engine that produced it, not by the server, so the cloud SDK types it
        // generically. Cast to the concrete type the local install step below (and
        // `runWorkspaceMoveWorkflow`) expects.
        return response.archive as unknown as WorkspaceMobilityArchive;
      }
      const connection = await resolveWorkspaceConnection(runtimeUrl, workspaceId!);
      return exportWorkspaceMobilityArchive(connection, connection.anyharnessWorkspaceId, {
        requireCleanGitState: true,
        expectedHandoffOpId: moveId,
        expectedBaseCommitSha: status.headOid,
        expectedBranchName: status.currentBranch ?? null,
      });
    },
    installArchive: async (moveId, archive) => {
      if (direction === "cloud_to_local") {
        const localConnection = resolveLocalAnyHarnessConnection(runtimeUrl);
        let targetWorkspaceId: string;
        if (destinationPlan?.mode === "re_adopt") {
          targetWorkspaceId = destinationPlan.workspaceId;
        } else {
          if (!localRepoRoot) {
            throw new Error("No local repository found to install this workspace into.");
          }
          const prepared = await prepareWorkspaceMobilityDestination(localConnection, localRepoRoot.id, {
            requestedBranch: status.currentBranch ?? "",
            requestedBaseSha: status.headOid,
          });
          targetWorkspaceId = prepared.workspace.id;
        }
        await installWorkspaceMobilityArchive(localConnection, targetWorkspaceId, {
          archive,
          operationId: moveId,
          installMode: "preserve_native_sessions",
        });
        if (destinationPlan?.mode === "re_adopt") {
          // The re-adopted workspace was left `remote_owned` by the earlier
          // local->cloud move (source-fate decision) -- flip it back to normal now
          // that it's live again (spec section 2.3 mirror step 3).
          await unfreezeWorkspace(localConnection, targetWorkspaceId);
        }
        // cloud->local's install call carries no archive -- the server can't reach
        // this local install, so it's just the durable "installed" acknowledgement
        // (spec section 5.2's `install_workspace_move_archive`, cloud->local branch).
        return phaseMutations.install.mutateAsync({ moveId, body: {} });
      }
      return phaseMutations.install.mutateAsync({ moveId, body: { archive } });
    },
    cutover: (moveId) => phaseMutations.cutover.mutateAsync(moveId),
    destroySource: async () => {
      const connection = await resolveWorkspaceConnection(runtimeUrl, workspaceId!);
      await destroyWorkspaceMobilitySource(connection, connection.anyharnessWorkspaceId);
    },
    markSourceRemoteOwned: async () => {
      const connection = await resolveWorkspaceConnection(runtimeUrl, workspaceId!);
      await markWorkspaceRemoteOwned(connection, connection.anyharnessWorkspaceId);
    },
    unfreezeSource: async (moveId) => {
      if (!moveId) return;
      // Generic by construction: `workspaceId` is whichever side is this move's own
      // source, and `resolveWorkspaceConnection` already routes a cloud synthetic id
      // through the gateway (spec section 5.4) -- so this reaches the cloud source
      // directly for `cloud_to_local` with no extra plumbing.
      const connection = await resolveWorkspaceConnection(runtimeUrl, workspaceId!);
      await unfreezeWorkspace(connection, connection.anyharnessWorkspaceId);
    },
    completeMove: (moveId) => phaseMutations.complete.mutateAsync(moveId),
    failMove: async (moveId, failureCode, failureDetail) => {
      await phaseMutations.fail.mutateAsync({ moveId, body: { failureCode, failureDetail } });
    },
    onPhaseChange: (phase) => setRunningPhase(phase),
  }), [direction, destinationPlan, localRepoRoot, phaseMutations, runtimeUrl, startMoveMutation, workspaceId]);

  const navigateAfterMove = usePostMoveNavigation(workspaceId);

  /** Runs (or resumes) the saga against a known-fresh git status snapshot -- callers
   *  that just pushed must pass the `refetch()` result, not the stale `gitStatusQuery.data`
   *  closure, since a push doesn't re-render before this function's continuation runs.
   *  `start` is always required (even when resuming): `runWorkspaceMoveWorkflow` only
   *  reads it for the "not_started"/"started" phases, but a resume from the transient
   *  "started" phase needs the *original* idempotencyKey to replay safely, so callers
   *  reconstruct it from the known move rather than this function guessing. Direction
   *  is derived from `start.source.kind` rather than threaded separately, so it can
   *  never disagree with the request actually being sent. */
  const runAndSettle = useCallback(async (input: {
    status: GitStatusSnapshot;
    start: StartWorkspaceMoveRequest;
    resume?: { moveId: string; phase: MovePhase };
  }) => {
    if (!workspaceId) return;
    const moveDirection: MoveDirection = input.start.source.kind === "cloud" ? "cloud_to_local" : "local_to_cloud";
    if (moveDirection === "local_to_cloud" && !workspaceKind) return;
    setError(null);
    setRunningPhase(input.resume?.phase ?? "running");
    try {
      const result = await runWorkspaceMoveWorkflow(
        {
          start: input.start,
          direction: moveDirection,
          sourceWorkspaceKind: workspaceKind ?? undefined,
          resume: input.resume,
        },
        buildDeps(input.status),
      );
      if (result.outcome === "failed") {
        if (result.failureCode === WORKSPACE_MOVE_CLOUD_WORKSPACE_EXISTS_ERROR_CODE) {
          rememberActiveWorkspaceMoveId(workspaceId, null);
          setRunningPhase(null);
          setCollision({
            gitOwner: repoRoot?.remoteOwner ?? "",
            gitRepoName: repoRoot?.remoteRepoName ?? "",
            branch: input.start.branch,
          });
          return;
        }
        rememberActiveWorkspaceMoveId(workspaceId, null);
        setRunningPhase(null);
        setError(result.failureDetail ?? "The move failed.");
        return;
      }
      rememberActiveWorkspaceMoveId(workspaceId, null);
      await invalidateWorkspaceCollections();
      setRunningPhase(null);
      setDone(true);
      navigateAfterMove(result.destinationCloudWorkspaceId);
    } catch (caught) {
      setRunningPhase(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [buildDeps, invalidateWorkspaceCollections, navigateAfterMove, repoRoot?.remoteOwner, repoRoot?.remoteRepoName, workspaceId, workspaceKind]);

  const startMove = useCallback(async () => {
    if (readiness.kind === "blocked") return;
    let status = gitStatusQuery.data ?? null;
    if (readiness.kind !== "safe") {
      const didPrepare = await publish.submit();
      if (!didPrepare) return;
      const refetched = await gitStatusQuery.refetch();
      status = refetched.data ?? null;
    }
    const branch = status?.currentBranch?.trim();
    if (!status || !branch) {
      setError(!status ? "Git status is still loading." : "This workspace has no current branch.");
      return;
    }
    if (!repoConfigId) {
      setError("Connect this repository to Proliferate Cloud first.");
      return;
    }

    if (direction === "cloud_to_local") {
      const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
      if (!cloudWorkspaceId) {
        setError("This isn't a cloud workspace.");
        return;
      }
      await runAndSettle({
        status,
        start: buildCloudToLocalMoveStartRequest({
          repoConfigId,
          branch,
          baseCommitSha: status.headOid,
          cloudWorkspaceId,
          desktopInstallId: await getDesktopInstallId(),
          localAnyharnessWorkspaceId: destinationPlan?.mode === "re_adopt" ? destinationPlan.workspaceId : null,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      return;
    }

    await runAndSettle({
      status,
      start: buildLocalToCloudMoveStartRequest({
        repoConfigId,
        branch,
        baseCommitSha: status.headOid,
        desktopInstallId: await getDesktopInstallId(),
        anyharnessWorkspaceId: workspaceId!,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
  }, [publish, readiness.kind, gitStatusQuery, repoConfigId, direction, destinationPlan, workspaceId, runAndSettle]);

  const resumeMove = useCallback(async () => {
    if (!activeMove || !gitStatusQuery.data || !workspaceId) return;
    const start = activeMove.sourceKind === "cloud"
      ? buildCloudToLocalMoveStartRequest({
        repoConfigId: activeMove.repoConfigId,
        branch: activeMove.branch,
        baseCommitSha: activeMove.baseCommitSha,
        cloudWorkspaceId: refString(activeMove.sourceRef, "cloudWorkspaceId") ?? "",
        desktopInstallId: refString(activeMove.destinationRef, "desktopInstallId") ?? "",
        localAnyharnessWorkspaceId: refString(activeMove.destinationRef, "anyharnessWorkspaceId"),
        idempotencyKey: activeMove.idempotencyKey,
      })
      : buildLocalToCloudMoveStartRequest({
        repoConfigId: activeMove.repoConfigId,
        branch: activeMove.branch,
        baseCommitSha: activeMove.baseCommitSha,
        desktopInstallId: refString(activeMove.sourceRef, "desktopInstallId") ?? "",
        anyharnessWorkspaceId: refString(activeMove.sourceRef, "anyharnessWorkspaceId") ?? workspaceId,
        idempotencyKey: activeMove.idempotencyKey,
      });
    await runAndSettle({
      status: gitStatusQuery.data,
      resume: { moveId: activeMove.id, phase: activeMove.phase },
      start,
    });
  }, [activeMove, gitStatusQuery.data, workspaceId, runAndSettle]);

  const abandonMove = useCallback(async () => {
    if (!activeMove || !workspaceId || isMovePostCutover(activeMove.phase)) return;
    setError(null);
    try {
      const connection = await resolveWorkspaceConnection(runtimeUrl, workspaceId);
      await unfreezeWorkspace(connection, connection.anyharnessWorkspaceId);
      await phaseMutations.fail.mutateAsync({
        moveId: activeMove.id,
        body: { failureCode: "abandoned_by_user", failureDetail: null },
      });
      rememberActiveWorkspaceMoveId(workspaceId, null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [activeMove, phaseMutations.fail, runtimeUrl, workspaceId]);

  const replaceCollidingWorkspace = useCallback(async (collidingWorkspaceId: string) => {
    if (!collision || !workspaceId || !gitStatusQuery.data || !repoConfigId) return;
    setError(null);
    try {
      await archiveCloudWorkspace(collidingWorkspaceId);
      const startedCollision = collision;
      setCollision(null);
      await runAndSettle({
        status: gitStatusQuery.data,
        start: buildLocalToCloudMoveStartRequest({
          repoConfigId,
          branch: startedCollision.branch,
          baseCommitSha: gitStatusQuery.data.headOid,
          desktopInstallId: await getDesktopInstallId(),
          anyharnessWorkspaceId: workspaceId,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [archiveCloudWorkspace, collision, gitStatusQuery.data, repoConfigId, runAndSettle, workspaceId]);

  const reset = useCallback(() => {
    setError(null);
    setCollision(null);
    setDone(false);
    setRunningPhase(null);
  }, []);

  return {
    direction,
    stage,
    readiness,
    publish,
    error: error ?? publish.error,
    isLoading: gitStatusQuery.isLoading || preflightQuery.isLoading,
    isSubmitting: runningPhase !== null || publish.isSubmitting || isArchivingCloudWorkspace,
    startMove,
    resumeMove,
    abandonMove,
    replaceCollidingWorkspace,
    reset,
  };
}
