import { getProliferateClient } from "./core.js";
import { legacyOpenApiClient } from "./legacy.js";
import type {
  CloudMobilityCleanupItemSummary,
  CloudMobilityHandoffSummary,
  CloudMobilityWorkspaceDetail,
  CloudMobilityWorkspaceSummary,
  CloudWorkspaceMobilityPreflightRequest,
  CloudWorkspaceMobilityPreflightResponse,
  EnsureCloudMobilityWorkspaceRequest,
  FailCloudMobilityCleanupItemRequest,
  FailCloudWorkspaceMobilityHandoffRequest,
  FinalizeCloudWorkspaceMobilityHandoffRequest,
  RepairCloudWorkspaceMobilityHandoffRequest,
  StartCloudWorkspaceMobilityHandoffRequest,
  UpdateCloudWorkspaceMobilityHandoffPhaseRequest,
} from "../types/index.js";

export async function listCloudMobilityWorkspaces(): Promise<CloudMobilityWorkspaceSummary[]> {
  return (await legacyOpenApiClient(getProliferateClient()).GET("/v1/cloud/mobility/workspaces")).data!;
}

export async function ensureCloudMobilityWorkspace(
  input: EnsureCloudMobilityWorkspaceRequest,
): Promise<CloudMobilityWorkspaceDetail> {
  return (
    await legacyOpenApiClient(getProliferateClient()).POST("/v1/cloud/mobility/workspaces/ensure", {
      body: input,
    })
  ).data!;
}

export async function getCloudMobilityWorkspaceDetail(
  mobilityWorkspaceId: string,
): Promise<CloudMobilityWorkspaceDetail> {
  return (
    await legacyOpenApiClient(getProliferateClient()).GET("/v1/cloud/mobility/workspaces/{mobility_workspace_id}", {
      params: { path: { mobility_workspace_id: mobilityWorkspaceId } },
    })
  ).data!;
}

export async function preflightCloudWorkspaceHandoff(
  mobilityWorkspaceId: string,
  input: CloudWorkspaceMobilityPreflightRequest,
): Promise<CloudWorkspaceMobilityPreflightResponse> {
  return (
    await legacyOpenApiClient(getProliferateClient()).POST(
      "/v1/cloud/mobility/workspaces/{mobility_workspace_id}/preflight",
      {
        params: { path: { mobility_workspace_id: mobilityWorkspaceId } },
        body: input,
      },
    )
  ).data!;
}

export async function startCloudWorkspaceHandoff(
  mobilityWorkspaceId: string,
  input: StartCloudWorkspaceMobilityHandoffRequest,
): Promise<CloudMobilityHandoffSummary> {
  return (
    await legacyOpenApiClient(getProliferateClient()).POST(
      "/v1/cloud/mobility/workspaces/{mobility_workspace_id}/handoffs/start",
      {
        params: { path: { mobility_workspace_id: mobilityWorkspaceId } },
        body: input,
      },
    )
  ).data!;
}

export async function heartbeatCloudWorkspaceHandoff(
  mobilityWorkspaceId: string,
  handoffOpId: string,
): Promise<CloudMobilityHandoffSummary> {
  return (
    await legacyOpenApiClient(getProliferateClient()).POST(
      "/v1/cloud/mobility/workspaces/{mobility_workspace_id}/handoffs/{handoff_op_id}/heartbeat",
      {
        params: {
          path: {
            mobility_workspace_id: mobilityWorkspaceId,
            handoff_op_id: handoffOpId,
          },
        },
      },
    )
  ).data!;
}

export async function updateCloudWorkspaceHandoffPhase(
  mobilityWorkspaceId: string,
  handoffOpId: string,
  input: UpdateCloudWorkspaceMobilityHandoffPhaseRequest,
): Promise<CloudMobilityHandoffSummary> {
  return (
    await legacyOpenApiClient(getProliferateClient()).POST(
      "/v1/cloud/mobility/workspaces/{mobility_workspace_id}/handoffs/{handoff_op_id}/phase",
      {
        params: {
          path: {
            mobility_workspace_id: mobilityWorkspaceId,
            handoff_op_id: handoffOpId,
          },
        },
        body: input,
      },
    )
  ).data!;
}

export async function finalizeCloudWorkspaceHandoff(
  mobilityWorkspaceId: string,
  handoffOpId: string,
  input: FinalizeCloudWorkspaceMobilityHandoffRequest,
): Promise<CloudMobilityHandoffSummary> {
  return (
    await legacyOpenApiClient(getProliferateClient()).POST(
      "/v1/cloud/mobility/workspaces/{mobility_workspace_id}/handoffs/{handoff_op_id}/finalize",
      {
        params: {
          path: {
            mobility_workspace_id: mobilityWorkspaceId,
            handoff_op_id: handoffOpId,
          },
        },
        body: input,
      },
    )
  ).data!;
}

export async function completeCloudWorkspaceHandoffCleanup(
  mobilityWorkspaceId: string,
  handoffOpId: string,
): Promise<CloudMobilityHandoffSummary> {
  return (
    await legacyOpenApiClient(getProliferateClient()).POST(
      "/v1/cloud/mobility/workspaces/{mobility_workspace_id}/handoffs/{handoff_op_id}/cleanup-complete",
      {
        params: {
          path: {
            mobility_workspace_id: mobilityWorkspaceId,
            handoff_op_id: handoffOpId,
          },
        },
      },
    )
  ).data!;
}

export async function listCloudWorkspaceHandoffCleanupItems(
  mobilityWorkspaceId: string,
  handoffOpId: string,
): Promise<CloudMobilityCleanupItemSummary[]> {
  return (
    await legacyOpenApiClient(getProliferateClient()).GET(
      "/v1/cloud/mobility/workspaces/{mobility_workspace_id}/handoffs/{handoff_op_id}/cleanup-items",
      {
        params: {
          path: {
            mobility_workspace_id: mobilityWorkspaceId,
            handoff_op_id: handoffOpId,
          },
        },
      },
    )
  ).data!;
}

export async function startCloudWorkspaceHandoffCleanupItem(
  mobilityWorkspaceId: string,
  handoffOpId: string,
  cleanupItemId: string,
): Promise<CloudMobilityCleanupItemSummary> {
  return (
    await legacyOpenApiClient(getProliferateClient()).POST(
      "/v1/cloud/mobility/workspaces/{mobility_workspace_id}/handoffs/{handoff_op_id}/cleanup-items/{cleanup_item_id}/start",
      {
        params: {
          path: {
            mobility_workspace_id: mobilityWorkspaceId,
            handoff_op_id: handoffOpId,
            cleanup_item_id: cleanupItemId,
          },
        },
      },
    )
  ).data!;
}

export async function completeCloudWorkspaceHandoffCleanupItem(
  mobilityWorkspaceId: string,
  handoffOpId: string,
  cleanupItemId: string,
): Promise<CloudMobilityCleanupItemSummary> {
  return (
    await legacyOpenApiClient(getProliferateClient()).POST(
      "/v1/cloud/mobility/workspaces/{mobility_workspace_id}/handoffs/{handoff_op_id}/cleanup-items/{cleanup_item_id}/complete",
      {
        params: {
          path: {
            mobility_workspace_id: mobilityWorkspaceId,
            handoff_op_id: handoffOpId,
            cleanup_item_id: cleanupItemId,
          },
        },
      },
    )
  ).data!;
}

export async function failCloudWorkspaceHandoffCleanupItem(
  mobilityWorkspaceId: string,
  handoffOpId: string,
  cleanupItemId: string,
  input: FailCloudMobilityCleanupItemRequest,
): Promise<CloudMobilityCleanupItemSummary> {
  return (
    await legacyOpenApiClient(getProliferateClient()).POST(
      "/v1/cloud/mobility/workspaces/{mobility_workspace_id}/handoffs/{handoff_op_id}/cleanup-items/{cleanup_item_id}/fail",
      {
        params: {
          path: {
            mobility_workspace_id: mobilityWorkspaceId,
            handoff_op_id: handoffOpId,
            cleanup_item_id: cleanupItemId,
          },
        },
        body: input,
      },
    )
  ).data!;
}

export async function repairCloudWorkspaceHandoff(
  mobilityWorkspaceId: string,
  handoffOpId: string,
  input: RepairCloudWorkspaceMobilityHandoffRequest,
): Promise<CloudMobilityHandoffSummary> {
  return (
    await legacyOpenApiClient(getProliferateClient()).POST(
      "/v1/cloud/mobility/workspaces/{mobility_workspace_id}/handoffs/{handoff_op_id}/repair",
      {
        params: {
          path: {
            mobility_workspace_id: mobilityWorkspaceId,
            handoff_op_id: handoffOpId,
          },
        },
        body: input,
      },
    )
  ).data!;
}

export async function failCloudWorkspaceHandoff(
  mobilityWorkspaceId: string,
  handoffOpId: string,
  input: FailCloudWorkspaceMobilityHandoffRequest,
): Promise<CloudMobilityHandoffSummary> {
  return (
    await legacyOpenApiClient(getProliferateClient()).POST(
      "/v1/cloud/mobility/workspaces/{mobility_workspace_id}/handoffs/{handoff_op_id}/fail",
      {
        params: {
          path: {
            mobility_workspace_id: mobilityWorkspaceId,
            handoff_op_id: handoffOpId,
          },
        },
        body: input,
      },
    )
  ).data!;
}
