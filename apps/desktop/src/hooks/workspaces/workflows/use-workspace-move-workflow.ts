import type { GitStatusSnapshot, RepoRoot, WorkspaceKind } from "@anyharness/sdk";
import { useGitStatusQuery } from "@anyharness/sdk-react";
import type { WorkspaceMoveResponse } from "@proliferate/cloud-sdk";
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
  markWorkspaceRemoteOwned,
  unfreezeWorkspace,
} from "@/lib/access/anyharness/mobility";
import { resolveWorkspaceConnection } from "@/lib/access/anyharness/resolve-workspace-connection";
import {
  isMovePostCutover,
  isNonTerminalMovePhase,
  resolveHandoffMoveId,
  type MovePhase,
  type MoveReadiness,
} from "@/lib/domain/workspaces/move/move-model";
import { resolveMoveReadiness } from "@/lib/domain/workspaces/move/move-readiness";
import {
  buildLocalToCloudMoveStartRequest,
  findCollidingCloudWorkspace,
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

// React wiring for the local->cloud workspace_move saga (spec section 2.3/5.4): composes
// the publish-prep machinery (git-status-driven stage/commit/push, reused wholesale --
// `initialIntent: "publish"` is exactly the local->cloud git-prep step) with the pure
// readiness resolver and the pure `runWorkspaceMoveWorkflow` sequencer from stage 1.
// Owns the one thing those pure layers can't: resolving live AnyHarness/cloud
// connections and driving React Query mutations.
export function useWorkspaceMoveWorkflow({
  workspaceId,
  workspaceKind,
  repoRoot,
  enabled,
}: UseWorkspaceMoveWorkflowOptions) {
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

  const repoConfigId = useMemo(
    () => resolveRepoConfigIdForRepoRoot(repoRoot, repositoriesQuery.data?.repositories ?? []),
    [repoRoot, repositoriesQuery.data?.repositories],
  );

  const activeMove = activeMoveQuery.data && isNonTerminalMovePhase(activeMoveQuery.data.phase)
    ? activeMoveQuery.data
    : null;

  const readiness = useMemo(
    () => resolveMoveReadiness({
      gitStatus: gitStatusQuery.data ?? null,
      sourcePreflight: preflightQuery.data ?? null,
      destinationState: null,
      activeMove,
    }),
    [activeMove, gitStatusQuery.data, preflightQuery.data],
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
      const connection = await resolveWorkspaceConnection(runtimeUrl, workspaceId!);
      return exportWorkspaceMobilityArchive(connection, connection.anyharnessWorkspaceId, {
        requireCleanGitState: true,
        expectedHandoffOpId: moveId,
        expectedBaseCommitSha: status.headOid,
        expectedBranchName: status.currentBranch ?? null,
      });
    },
    installArchive: (moveId, archive) =>
      phaseMutations.install.mutateAsync({ moveId, body: { archive } }),
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
      const connection = await resolveWorkspaceConnection(runtimeUrl, workspaceId!);
      await unfreezeWorkspace(connection, connection.anyharnessWorkspaceId);
    },
    completeMove: (moveId) => phaseMutations.complete.mutateAsync(moveId),
    failMove: async (moveId, failureCode, failureDetail) => {
      await phaseMutations.fail.mutateAsync({ moveId, body: { failureCode, failureDetail } });
    },
    onPhaseChange: (phase) => setRunningPhase(phase),
  }), [phaseMutations, runtimeUrl, startMoveMutation, workspaceId]);

  const navigateAfterMove = usePostMoveNavigation(workspaceId);

  /** Runs (or resumes) the saga against a known-fresh git status snapshot -- callers
   *  that just pushed must pass the `refetch()` result, not the stale `gitStatusQuery.data`
   *  closure, since a push doesn't re-render before this function's continuation runs.
   *  `start` is always required (even when resuming): `runWorkspaceMoveWorkflow` only
   *  reads it for the "not_started"/"started" phases, but a resume from the transient
   *  "started" phase needs the *original* idempotencyKey to replay safely, so callers
   *  reconstruct it from the known move rather than this function guessing. */
  const runAndSettle = useCallback(async (input: {
    status: GitStatusSnapshot;
    start: Parameters<typeof buildLocalToCloudMoveStartRequest>[0];
    resume?: { moveId: string; phase: MovePhase };
  }) => {
    if (!workspaceId || !workspaceKind) return;
    setError(null);
    setRunningPhase(input.resume?.phase ?? "running");
    try {
      const start = buildLocalToCloudMoveStartRequest(input.start);
      const result = await runWorkspaceMoveWorkflow(
        { start, sourceWorkspaceKind: workspaceKind, resume: input.resume },
        buildDeps(input.status),
      );
      if (result.outcome === "failed") {
        if (result.failureCode === WORKSPACE_MOVE_CLOUD_WORKSPACE_EXISTS_ERROR_CODE) {
          rememberActiveWorkspaceMoveId(workspaceId, null);
          setRunningPhase(null);
          setCollision({ gitOwner: repoRoot?.remoteOwner ?? "", gitRepoName: repoRoot?.remoteRepoName ?? "", branch: start.branch });
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
    await runAndSettle({
      status,
      start: {
        repoConfigId,
        branch,
        baseCommitSha: status.headOid,
        desktopInstallId: await getDesktopInstallId(),
        anyharnessWorkspaceId: workspaceId!,
        idempotencyKey: crypto.randomUUID(),
      },
    });
  }, [publish, readiness.kind, gitStatusQuery, repoConfigId, workspaceId, runAndSettle]);

  const resumeMove = useCallback(async () => {
    if (!activeMove || !gitStatusQuery.data || !workspaceId) return;
    const sourceRef = activeMove.sourceRef as { desktopInstallId?: string; anyharnessWorkspaceId?: string };
    await runAndSettle({
      status: gitStatusQuery.data,
      resume: { moveId: activeMove.id, phase: activeMove.phase },
      start: {
        repoConfigId: activeMove.repoConfigId,
        branch: activeMove.branch,
        baseCommitSha: activeMove.baseCommitSha,
        desktopInstallId: sourceRef.desktopInstallId ?? "",
        anyharnessWorkspaceId: sourceRef.anyharnessWorkspaceId ?? workspaceId,
        idempotencyKey: activeMove.idempotencyKey,
      },
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
        start: {
          repoConfigId,
          branch: startedCollision.branch,
          baseCommitSha: gitStatusQuery.data.headOid,
          desktopInstallId: await getDesktopInstallId(),
          anyharnessWorkspaceId: workspaceId,
          idempotencyKey: crypto.randomUUID(),
        },
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
