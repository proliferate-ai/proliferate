import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  ArchiveCloudTargetResponse,
  CloudTargetDetail,
  CloudTargetExistingEnrollmentRequest,
  CloudTargetEnrollmentRequest,
  CloudTargetEnrollmentResponse,
  CloudTargetRuntimeAccessResponse,
  CloudTargetSummary,
} from "../types/index.js";

export async function createTargetEnrollment(
  body: CloudTargetEnrollmentRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudTargetEnrollmentResponse> {
  return client.requestJson<CloudTargetEnrollmentResponse>({
    method: "POST",
    path: "/v1/cloud/targets/enrollments",
    body,
  });
}

export async function createExistingTargetEnrollment(
  targetId: string,
  body: CloudTargetExistingEnrollmentRequest = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudTargetEnrollmentResponse> {
  return client.requestJson<CloudTargetEnrollmentResponse>({
    method: "POST",
    path: "/v1/cloud/targets/{target_id}/enrollments",
    pathParams: { target_id: targetId },
    body,
  });
}

export async function listTargets(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudTargetSummary[]> {
  return client.requestJson<CloudTargetSummary[]>({
    method: "GET",
    path: "/v1/cloud/targets",
  });
}

export async function getTarget(
  targetId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudTargetDetail> {
  return client.requestJson<CloudTargetDetail>({
    method: "GET",
    path: "/v1/cloud/targets/{target_id}",
    pathParams: { target_id: targetId },
  });
}

export async function getTargetRuntimeAccess(
  targetId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudTargetRuntimeAccessResponse> {
  return client.requestJson<CloudTargetRuntimeAccessResponse>({
    method: "GET",
    path: "/v1/cloud/targets/{target_id}/runtime-access",
    pathParams: { target_id: targetId },
  });
}

export async function archiveTarget(
  targetId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<ArchiveCloudTargetResponse> {
  return client.requestJson<ArchiveCloudTargetResponse>({
    method: "POST",
    path: "/v1/cloud/targets/{target_id}/archive",
    pathParams: { target_id: targetId },
  });
}
