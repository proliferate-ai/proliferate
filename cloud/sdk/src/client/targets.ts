import { getProliferateClient } from "./core";
import type {
  CloudTargetDetail,
  CloudTargetEnrollmentRequest,
  CloudTargetEnrollmentResponse,
  CloudTargetSummary,
} from "../types";

export async function createTargetEnrollment(
  body: CloudTargetEnrollmentRequest,
): Promise<CloudTargetEnrollmentResponse> {
  return getProliferateClient().requestJson<CloudTargetEnrollmentResponse>({
    method: "POST",
    path: "/v1/cloud/targets/enrollments",
    body,
  });
}

export async function listTargets(): Promise<CloudTargetSummary[]> {
  return getProliferateClient().requestJson<CloudTargetSummary[]>({
    method: "GET",
    path: "/v1/cloud/targets",
  });
}

export async function getTarget(targetId: string): Promise<CloudTargetDetail> {
  return getProliferateClient().requestJson<CloudTargetDetail>({
    method: "GET",
    path: "/v1/cloud/targets/{target_id}",
    pathParams: { target_id: targetId },
  });
}

