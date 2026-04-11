import { getProliferateClient } from "./client";
import type {
  CloudMobilityHandoffSummary,
  CloudMobilityWorkspaceDetail,
  CloudMobilityWorkspaceSummary,
  CloudWorkspaceMobilityPreflightRequest,
  CloudWorkspaceMobilityPreflightResponse,
  EnsureCloudMobilityWorkspaceRequest,
  FailCloudWorkspaceMobilityHandoffRequest,
  FinalizeCloudWorkspaceMobilityHandoffRequest,
  StartCloudWorkspaceMobilityHandoffRequest,
  UpdateCloudWorkspaceMobilityHandoffPhaseRequest,
} from "./client";

export async function listCloudMobilityWorkspaces(): Promise<CloudMobilityWorkspaceSummary[]> {
  return (await getProliferateClient().GET("/v1/cloud/mobility/workspaces")).data!;
}

export async function ensureCloudMobilityWorkspace(
  input: EnsureCloudMobilityWorkspaceRequest,
): Promise<CloudMobilityWorkspaceDetail> {
  return (
    await getProliferateClient().POST("/v1/cloud/mobility/workspaces/ensure", {
      body: input,
    })
  ).data!;
}

export async function getCloudMobilityWorkspaceDetail(
  mobilityWorkspaceId: string,
): Promise<CloudMobilityWorkspaceDetail> {
  return (
    await getProliferateClient().GET("/v1/cloud/mobility/workspaces/{mobility_workspace_id}", {
      params: { path: { mobility_workspace_id: mobilityWorkspaceId } },
    })
  ).data!;
}

export async function preflightCloudWorkspaceHandoff(
  mobilityWorkspaceId: string,
  input: CloudWorkspaceMobilityPreflightRequest,
): Promise<CloudWorkspaceMobilityPreflightResponse> {
  return (
    await getProliferateClient().POST(
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
    await getProliferateClient().POST(
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
    await getProliferateClient().POST(
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
    await getProliferateClient().POST(
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
    await getProliferateClient().POST(
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
    await getProliferateClient().POST(
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

export async function failCloudWorkspaceHandoff(
  mobilityWorkspaceId: string,
  handoffOpId: string,
  input: FailCloudWorkspaceMobilityHandoffRequest,
): Promise<CloudMobilityHandoffSummary> {
  return (
    await getProliferateClient().POST(
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
