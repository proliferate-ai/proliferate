import type {
  DestroyWorkspaceMobilitySourceRequest,
  DestroyWorkspaceMobilitySourceResponse,
  ExportWorkspaceMobilityArchiveRequest,
  InstallWorkspaceMobilityArchiveRequest,
  InstallWorkspaceMobilityArchiveResponse,
  PrepareRepoRootMobilityDestinationRequest,
  PrepareRepoRootMobilityDestinationResponse,
  WorkspaceMobilityArchive,
  WorkspaceMobilityPreflightResponse,
  WorkspaceMobilityRuntimeState,
} from "@anyharness/sdk";
import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";
import type { MobilityInstallMode } from "@/lib/domain/workspaces/move/move-model";

// Raw AnyHarness mobility calls (preflight / freeze-unfreeze / export / install /
// prepare-destination / destroy-source) against a resolved runtime connection -- the
// engine surface the workspace_move workflow drives on each side
// (specs/tbd/workspace-migration-v2.md section 2.3/2.4). For local->cloud the server
// forwards the exported archive to the destination sandbox's own AnyHarness install
// route, so desktop only needs preflight/freeze/export/destroy-source for that
// direction; the cloud->local mirror installs into its local destination directly via
// this module's `installWorkspaceMobilityArchive`/`prepareWorkspaceMobilityDestination`
// (spec section 2.3 mirror step 3).

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

/** Prepares (or re-adopts) the local destination worktree for the cloud->local mirror
 *  (spec section 2.3 mirror step 3 / section 5.1's `prepare-destination`). Only used
 *  for the `prepare_fresh` plan -- a `re_adopt` plan already knows the target
 *  workspace id and installs straight into it. */
export function prepareWorkspaceMobilityDestination(
  connection: AnyHarnessClientConnection,
  repoRootId: string,
  input: PrepareRepoRootMobilityDestinationRequest,
): Promise<PrepareRepoRootMobilityDestinationResponse> {
  return getAnyHarnessClient(connection).repoRoots.prepareDestination(repoRootId, input);
}

/**
 * Installs a mobility archive with the v2 engine's `installMode` field (spec section
 * 2.4/5.1) -- used by the cloud->local mirror's local install step, always with
 * `preserve_native_sessions` (locked design). The generated
 * `InstallWorkspaceMobilityArchiveRequest` type hasn't been regenerated with this field
 * yet (it lands with the anyharness engine v2 PR); `body` is typed as an intersection
 * rather than an inline object literal at the call site specifically so this doesn't
 * trip the client method's excess-property check. Sent as a plain extra JSON field:
 * this stack's runtime honors it, an older runtime would silently ignore it.
 */
export function installWorkspaceMobilityArchive(
  connection: AnyHarnessClientConnection,
  workspaceId: string,
  input: {
    archive: WorkspaceMobilityArchive;
    operationId?: string | null;
    installMode: MobilityInstallMode;
  },
): Promise<InstallWorkspaceMobilityArchiveResponse> {
  const body: InstallWorkspaceMobilityArchiveRequest & { installMode: MobilityInstallMode } = {
    archive: input.archive,
    operationId: input.operationId ?? undefined,
    installMode: input.installMode,
  };
  return getAnyHarnessClient(connection).mobility.installArchive(workspaceId, body);
}
