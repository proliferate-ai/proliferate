import type {
  AnyHarnessRequestOptions,
  CreateWorkspaceRequest,
  CreateWorktreeWorkspaceRequest,
  UpdateWorkspaceDisplayNameRequest,
} from "@anyharness/sdk";
import {
  getAnyHarnessClient,
  type AnyHarnessClientConnection,
  type AnyHarnessResolvedConnection,
} from "@anyharness/sdk-react";

type WorkspaceConnection = AnyHarnessClientConnection | AnyHarnessResolvedConnection;

export function listRuntimeWorkspaces(
  connection: AnyHarnessClientConnection,
  request?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).workspaces.list(request);
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

export function getWorkspaceSessionLaunchCatalog(
  connection: AnyHarnessResolvedConnection,
  request?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).workspaces.getSessionLaunchCatalog(
    connection.anyharnessWorkspaceId,
    request,
  );
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

export function retireWorkspace(connection: WorkspaceConnection, workspaceId: string) {
  return getAnyHarnessClient(connection).workspaces.retire(workspaceId);
}

export function getWorkspaceRetirePreflight(
  connection: WorkspaceConnection,
  workspaceId: string,
  options?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).workspaces.retirePreflight(workspaceId, options);
}

export function retryRetireWorkspaceCleanup(
  connection: WorkspaceConnection,
  workspaceId: string,
) {
  return getAnyHarnessClient(connection).workspaces.retryRetireCleanup(workspaceId);
}

export function purgeWorkspace(connection: WorkspaceConnection, workspaceId: string) {
  return getAnyHarnessClient(connection).workspaces.purge(workspaceId);
}

export function retryPurgeWorkspace(connection: WorkspaceConnection, workspaceId: string) {
  return getAnyHarnessClient(connection).workspaces.retryPurge(workspaceId);
}
