import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import {
  measureCloudRequest,
  type CloudMeasurementOptions,
} from "./timing.js";
import type {
  CloudWorkspaceDetail,
  CloudWorkspaceStatus,
  CloudWorkspaceSummary,
  CloudWorkspaceMaterializationSummary,
  CreateCloudWorkspaceRequest,
  CreateMaterializationIntentRequest,
  MaterializationIntentResponse,
  ReportMaterializationRequest,
  CloudWorkspaceRuntimeStatusResponse,
} from "../types/index.js";
import type { CloudOwnerSelection } from "./billing.js";

export type CloudWorkspaceListScope =
  | "my"
  | "unclaimed"
  | "claimable"
  | "org-all"
  | "exposed";
export type CloudWorkspaceLifecycleFilter = "active" | "archived" | "all";
export type CloudWorkspaceListSelection = {
  scope?: CloudWorkspaceListScope;
  lifecycle?: CloudWorkspaceLifecycleFilter;
  /** This install's id. The server prefers its hydrated local materialization
   * as the selected target and un-redacts its worktree path/AnyHarness id;
   * omitting it routes selection to managed Cloud and redacts local rows. */
  desktopInstallId?: string | null;
};

type CloudWorkspaceTransport = Record<string, unknown> & {
  actionBlockKind?: string | null;
  actionBlockReason?: string | null;
  productLifecycle?: string;
  runtime?: {
    actionBlockKind?: string | null;
    actionBlockReason?: string | null;
  } | null;
  status?: string;
  workspaceStatus?: string;
};

function normalizeCloudWorkspaceStatus(value: string | undefined): CloudWorkspaceStatus {
  switch (value) {
    case "pending":
    case "queued":
      return "pending";
    case "materializing":
    case "provisioning":
    case "syncing_credentials":
    case "cloning_repo":
    case "starting_runtime":
      return "materializing";
    case "needs_rematerialization":
      return "needs_rematerialization";
    case "ready":
      return "ready";
    case "archived":
    case "stopped":
      return "archived";
    case "error":
    default:
      return "error";
  }
}

function normalizeCloudWorkspace<T extends CloudWorkspaceTransport>(
  workspace: T,
): T & {
  status: CloudWorkspaceStatus;
  workspaceStatus: CloudWorkspaceStatus;
  productLifecycle: string;
} {
  const status = normalizeCloudWorkspaceStatus(workspace.workspaceStatus ?? workspace.status);
  return {
    ...workspace,
    actionBlockKind: workspace.runtime?.actionBlockKind ?? workspace.actionBlockKind ?? null,
    actionBlockReason: workspace.runtime?.actionBlockReason ?? workspace.actionBlockReason ?? null,
    status,
    workspaceStatus: status,
    productLifecycle: workspace.productLifecycle ?? (status === "archived" ? "archived" : "active"),
  };
}

export async function listCloudWorkspaces(
  options?: CloudMeasurementOptions,
  owner?: CloudWorkspaceListSelection,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudWorkspaceSummary[]> {
  const data = await measureCloudRequest({
    operationId: options?.measurementOperationId,
    category: "cloud.workspace.list",
    method: "GET",
    run: async () =>
      client.requestJson<CloudWorkspaceTransport[]>({
        method: "GET",
        path: "/v1/cloud/workspaces",
        query: {
          lifecycle: owner?.lifecycle,
          desktopInstallId: owner?.desktopInstallId ?? undefined,
        },
        signal: options?.signal,
      }),
  });
  return data.map(
    (workspace) => normalizeCloudWorkspace(workspace) as unknown as CloudWorkspaceSummary,
  );
}

export async function getCloudWorkspace(
  workspaceId: string,
  client: ProliferateCloudClient = getProliferateClient(),
  desktopInstallId?: string | null,
): Promise<CloudWorkspaceDetail | undefined> {
  const data = await client.requestJson<CloudWorkspaceTransport | null>({
    method: "GET",
    path: `/v1/cloud/workspaces/${encodeURIComponent(workspaceId)}`,
    query: { desktopInstallId: desktopInstallId ?? undefined },
  });
  return data ? (normalizeCloudWorkspace(data) as CloudWorkspaceDetail) : undefined;
}

/** Create (or reuse) a local-desktop materialization intent for this install.
 * Returns the intent + the exact source ref (repo/branch/HEAD) + operationId to
 * thread verbatim into the AnyHarness exact-ref materialization. */
export async function createLocalMaterializationIntent(
  workspaceId: string,
  body: CreateMaterializationIntentRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<MaterializationIntentResponse> {
  return client.requestJson<MaterializationIntentResponse>({
    method: "POST",
    path: `/v1/cloud/workspaces/${encodeURIComponent(workspaceId)}/materializations`,
    body,
  });
}

/** Report the outcome of a local materialization attempt. A hydrated report
 * must carry the exact observedHeadSha/observedBranch and the current
 * generation, or the server rejects it as stale/mismatched. */
export async function reportMaterialization(
  workspaceId: string,
  materializationId: string,
  body: ReportMaterializationRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudWorkspaceMaterializationSummary> {
  return client.requestJson<CloudWorkspaceMaterializationSummary>({
    method: "PUT",
    path: `/v1/cloud/workspaces/${encodeURIComponent(workspaceId)}/materializations/${
      encodeURIComponent(materializationId)
    }`,
    body,
  });
}

/** Unlink this install's local materialization (association-only; deletes no
 * checkout, Cloud workspace, or history). Idempotent on an already-unlinked
 * row. */
export async function unlinkMaterialization(
  workspaceId: string,
  materializationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await client.requestJson<unknown>({
    method: "DELETE",
    path: `/v1/cloud/workspaces/${encodeURIComponent(workspaceId)}/materializations/${
      encodeURIComponent(materializationId)
    }`,
  });
}

export async function createCloudWorkspace(
  input: CreateCloudWorkspaceRequest,
  owner?: CloudOwnerSelection,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudWorkspaceDetail> {
  void owner;
  const data = await client.requestJson<CloudWorkspaceTransport>({
    method: "POST",
    path: "/v1/cloud/workspaces",
    body: input,
  });
  return normalizeCloudWorkspace(data) as CloudWorkspaceDetail;
}

export async function archiveCloudWorkspace(
  workspaceId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudWorkspaceDetail> {
  const data = await client.requestJson<CloudWorkspaceTransport>({
    method: "POST",
    path: `/v1/cloud/workspaces/${encodeURIComponent(workspaceId)}/archive`,
  });
  return normalizeCloudWorkspace(data) as CloudWorkspaceDetail;
}

export async function restoreCloudWorkspace(
  workspaceId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudWorkspaceDetail> {
  const data = await client.requestJson<CloudWorkspaceTransport>({
    method: "POST",
    path: `/v1/cloud/workspaces/${encodeURIComponent(workspaceId)}/restore`,
  });
  return normalizeCloudWorkspace(data) as CloudWorkspaceDetail;
}

export async function updateCloudWorkspaceDisplayName(
  workspaceId: string,
  displayName: string | null,
  options?: CloudMeasurementOptions,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudWorkspaceDetail> {
  const data = await measureCloudRequest({
    operationId: options?.measurementOperationId,
    category: "cloud.workspace.display_name.update",
    method: "PATCH",
    run: async () =>
      client.requestJson<CloudWorkspaceTransport>({
        method: "PATCH",
        path: `/v1/cloud/workspaces/${encodeURIComponent(workspaceId)}/display-name`,
        body: { displayName },
      }),
  });
  return normalizeCloudWorkspace(data) as CloudWorkspaceDetail;
}

export async function deleteCloudWorkspace(
  workspaceId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await client.requestJson<unknown>({
    method: "DELETE",
    path: `/v1/cloud/workspaces/${encodeURIComponent(workspaceId)}`,
  });
}

export async function getCloudWorkspaceRuntimeStatus(
  workspaceId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudWorkspaceRuntimeStatusResponse> {
  return client.requestJson<CloudWorkspaceRuntimeStatusResponse>({
    method: "GET",
    path: `/v1/cloud/workspaces/${encodeURIComponent(workspaceId)}/runtime-status`,
  });
}
