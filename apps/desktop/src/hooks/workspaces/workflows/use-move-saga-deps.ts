import type { GitStatusSnapshot, RepoRoot, WorkspaceMobilityArchive } from "@anyharness/sdk";
import { useCallback } from "react";
import { useStartWorkspaceMove } from "@/hooks/access/cloud/workspace-moves/use-start-workspace-move-mutation";
import { useWorkspaceMovePhaseMutations } from "@/hooks/access/cloud/workspace-moves/use-workspace-move-phase-mutations";
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
import type { LocalMoveDestinationPlan } from "@/lib/domain/workspaces/move/move-destination";
import type { MoveDirection, MovePhase } from "@/lib/domain/workspaces/move/move-model";
import type { WorkspaceMoveWorkflowDeps } from "@/lib/workflows/workspaces/run-workspace-move-workflow";
import { rememberActiveWorkspaceMoveId } from "@/stores/workspaces/workspace-move-store";

export interface UseMoveSagaDepsInput {
  direction: MoveDirection | null;
  workspaceId: string | null;
  runtimeUrl: string;
  destinationPlan: LocalMoveDestinationPlan | null;
  localRepoRoot: RepoRoot | null;
  startMoveMutation: ReturnType<typeof useStartWorkspaceMove>;
  phaseMutations: ReturnType<typeof useWorkspaceMovePhaseMutations>;
  setRunningPhase: (phase: MovePhase) => void;
}

// Builds the `WorkspaceMoveWorkflowDeps` for `runWorkspaceMoveWorkflow` -- the one thing
// the pure saga sequencer can't do: resolving live AnyHarness/cloud connections and
// driving React Query mutations, bound to the right transport per `direction`. Split out
// of useWorkspaceMoveWorkflow; returns a `buildDeps(status)` factory (deferred until a
// known-fresh git-status snapshot is in hand -- see runWorkspaceMoveWorkflow).
export function useMoveSagaDeps({
  direction,
  workspaceId,
  runtimeUrl,
  destinationPlan,
  localRepoRoot,
  startMoveMutation,
  phaseMutations,
  setRunningPhase,
}: UseMoveSagaDepsInput) {
  return useCallback((status: GitStatusSnapshot): WorkspaceMoveWorkflowDeps => ({
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
  }), [direction, destinationPlan, localRepoRoot, phaseMutations, runtimeUrl, setRunningPhase, startMoveMutation, workspaceId]);
}
