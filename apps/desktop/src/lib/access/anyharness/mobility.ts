import type {
  DestroyWorkspaceMobilitySourceRequest,
  DestroyWorkspaceMobilitySourceResponse,
  ExportWorkspaceMobilityArchiveRequest,
  WorkspaceMobilityArchive,
  WorkspaceMobilityPreflightResponse,
  WorkspaceMobilityRuntimeState,
} from "@anyharness/sdk";
import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";

// Raw AnyHarness mobility calls (preflight / freeze-unfreeze / export / destroy-source)
// against a resolved runtime connection -- the engine surface the workspace_move
// workflow drives on each side (specs/tbd/workspace-migration-v2.md section 2.3/2.4).
// Desktop never calls the install endpoint from this flow: for local->cloud the server
// forwards the exported archive to the destination sandbox's own AnyHarness install
// route, and desktop only needs preflight/freeze/export/destroy-source here.

export function getWorkspaceMobilityPreflight(
  connection: AnyHarnessClientConnection,
  workspaceId: string,
): Promise<WorkspaceMobilityPreflightResponse> {
  return getAnyHarnessClient(connection).mobility.preflight(workspaceId);
}

export function freezeWorkspaceForHandoff(
  connection: AnyHarnessClientConnection,
  workspaceId: string,
  handoffOpId: string,
): Promise<WorkspaceMobilityRuntimeState> {
  return getAnyHarnessClient(connection).mobility.updateRuntimeState(workspaceId, {
    mode: "frozen_for_handoff",
    handoffOpId,
  });
}

/** Unfreezes the source back to normal -- used on pre-cutover failure/abandon so the
 *  source workspace isn't left stuck read-only. */
export function unfreezeWorkspace(
  connection: AnyHarnessClientConnection,
  workspaceId: string,
): Promise<WorkspaceMobilityRuntimeState> {
  return getAnyHarnessClient(connection).mobility.updateRuntimeState(workspaceId, {
    mode: "normal",
    handoffOpId: null,
  });
}

/** Post-cutover source-fate step for a plain local-directory workspace (source-fate
 *  decision: mark remote_owned, never delete user files). */
export function markWorkspaceRemoteOwned(
  connection: AnyHarnessClientConnection,
  workspaceId: string,
): Promise<WorkspaceMobilityRuntimeState> {
  return getAnyHarnessClient(connection).mobility.updateRuntimeState(workspaceId, {
    mode: "remote_owned",
    handoffOpId: null,
  });
}

export function exportWorkspaceMobilityArchive(
  connection: AnyHarnessClientConnection,
  workspaceId: string,
  input: ExportWorkspaceMobilityArchiveRequest,
): Promise<WorkspaceMobilityArchive> {
  return getAnyHarnessClient(connection).mobility.exportArchive(workspaceId, input);
}

/** Post-cutover source-fate step for a managed worktree (source-fate decision: destroy
 *  the worktree). */
export function destroyWorkspaceMobilitySource(
  connection: AnyHarnessClientConnection,
  workspaceId: string,
  input?: DestroyWorkspaceMobilitySourceRequest,
): Promise<DestroyWorkspaceMobilitySourceResponse> {
  return getAnyHarnessClient(connection).mobility.destroySource(workspaceId, input);
}
