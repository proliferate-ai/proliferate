import type {
  AnyHarnessRequestOptions,
  ArchiveWorkspaceRequest,
  CreateWorkspaceRequest,
  CreateWorktreeWorkspaceRequest,
  UnarchiveWorkspaceRequest,
  UpdateWorkspaceDisplayNameRequest,
  WorkspaceLifecycleFilter,
} from "@anyharness/sdk";
import {
  getAnyHarnessClient,
  type AnyHarnessClientConnection,
  type AnyHarnessResolvedConnection,
} from "@anyharness/sdk-react";

type WorkspaceConnection = AnyHarnessClientConnection | AnyHarnessResolvedConnection;

/**
 * The workspace list. Omit `lifecycle` for the route's `active` default (the
 * collections query's universe); the archived page passes `"archived"`
 * explicitly. The lifecycle filter is a positional SDK parameter, not part of
 * `AnyHarnessRequestOptions` — keeping it a separate argument here (rather
 * than folding it into `request`) matches the generated client's shape.
 */
export function listRuntimeWorkspaces(
  connection: AnyHarnessClientConnection,
  lifecycle?: WorkspaceLifecycleFilter,
  request?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).workspaces.list(lifecycle, request);
}

export function archiveWorkspace(
  connection: WorkspaceConnection,
  workspaceId: string,
  request?: ArchiveWorkspaceRequest,
) {
  return getAnyHarnessClient(connection).workspaces.archive(workspaceId, request);
}

export function unarchiveWorkspace(
  connection: WorkspaceConnection,
  workspaceId: string,
  request?: UnarchiveWorkspaceRequest,
) {
  return getAnyHarnessClient(connection).workspaces.unarchive(workspaceId, request);
}

export function listRepoRoots(
  connection: AnyHarnessClientConnection,
  request?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).repoRoots.list(request);
}

type AnyHarnessClient = ReturnType<typeof getAnyHarnessClient>;
type GetWorkspaceOptions = Parameters<AnyHarnessClient["workspaces"]["get"]>[1];
type UpdateWorkspaceDisplayNameOptions =
  Parameters<AnyHarnessClient["workspaces"]["updateDisplayName"]>[2];

export function getWorkspace(
  connection: WorkspaceConnection,
  workspaceId: string,
  options?: GetWorkspaceOptions,
) {
  return getAnyHarnessClient(connection).workspaces.get(workspaceId, options);
}

export function createWorkspace(
  connection: AnyHarnessClientConnection,
  request: CreateWorkspaceRequest,
) {
  return getAnyHarnessClient(connection).workspaces.create(request);
}

export function resolveWorkspaceFromPath(
  connection: AnyHarnessClientConnection,
  request: CreateWorkspaceRequest,
) {
  return getAnyHarnessClient(connection).workspaces.resolveFromPath(request);
}

export function createWorktreeWorkspace(
  connection: AnyHarnessClientConnection,
  request: CreateWorktreeWorkspaceRequest,
  options?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).workspaces.createWorktree(request, options);
}

export function getWorkspaceSetupStatus(
  connection: AnyHarnessResolvedConnection,
  request?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).workspaces.getSetupStatus(
    connection.anyharnessWorkspaceId,
    request,
  );
}

export function updateWorkspaceDisplayName(
  connection: WorkspaceConnection,
  workspaceId: string,
  request: UpdateWorkspaceDisplayNameRequest,
  options?: UpdateWorkspaceDisplayNameOptions,
) {
  return getAnyHarnessClient(connection).workspaces.updateDisplayName(
    workspaceId,
    request,
    options,
  );
}

export function purgeWorkspace(connection: WorkspaceConnection, workspaceId: string) {
  return getAnyHarnessClient(connection).workspaces.purge(workspaceId);
}
