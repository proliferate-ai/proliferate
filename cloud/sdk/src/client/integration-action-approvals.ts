import type {
  IntegrationActionApproval,
  IntegrationActionApprovalListResponse,
  IntegrationActionApprovalStatus,
  IntegrationActionApprovalTransitionResponse,
} from "../types/index.js";
import { getProliferateClient, type ProliferateCloudClient } from "./core.js";

export interface ListIntegrationActionApprovalsOptions {
  status?: IntegrationActionApprovalStatus | null;
}

export async function listIntegrationActionApprovals(
  options: ListIntegrationActionApprovalsOptions = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationActionApprovalListResponse> {
  return client.requestJson<IntegrationActionApprovalListResponse>({
    method: "GET",
    path: "/v1/cloud/integrations/action-approvals",
    query: { status: options.status ?? undefined },
  });
}

export async function getIntegrationActionApproval(
  approvalId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationActionApproval> {
  return client.requestJson<IntegrationActionApproval>({
    method: "GET",
    path: "/v1/cloud/integrations/action-approvals/{approval_id}",
    pathParams: { approval_id: approvalId },
  });
}

export async function approveIntegrationActionApproval(
  approvalId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationActionApprovalTransitionResponse> {
  return transitionIntegrationActionApproval(approvalId, "approve", client);
}

export async function rejectIntegrationActionApproval(
  approvalId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationActionApprovalTransitionResponse> {
  return transitionIntegrationActionApproval(approvalId, "reject", client);
}

export async function revokeIntegrationActionApproval(
  approvalId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationActionApprovalTransitionResponse> {
  return transitionIntegrationActionApproval(approvalId, "revoke", client);
}

async function transitionIntegrationActionApproval(
  approvalId: string,
  decision: "approve" | "reject" | "revoke",
  client: ProliferateCloudClient,
): Promise<IntegrationActionApprovalTransitionResponse> {
  return client.requestJson<IntegrationActionApprovalTransitionResponse>({
    method: "POST",
    path: `/v1/cloud/integrations/action-approvals/{approval_id}/${decision}`,
    pathParams: { approval_id: approvalId },
  });
}
