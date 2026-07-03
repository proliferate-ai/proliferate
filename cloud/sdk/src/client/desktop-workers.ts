import { getProliferateClient, type ProliferateCloudClient } from "./core.js";

export interface DesktopWorkerEnrollmentResponse {
  enrollmentToken: string;
  expiresAt: string;
}

export async function enrollDesktopWorker(
  desktopInstallId: string,
  organizationId: string | null = null,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<DesktopWorkerEnrollmentResponse> {
  return client.requestJson<DesktopWorkerEnrollmentResponse>({
    method: "POST",
    path: "/v1/cloud/workers/desktop/enrollment",
    body: { desktopInstallId, organizationId },
  });
}

export interface DesktopWorkerRevokeResponse {
  revoked: boolean;
}

export async function revokeDesktopWorker(
  desktopInstallId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<DesktopWorkerRevokeResponse> {
  return client.requestJson<DesktopWorkerRevokeResponse>({
    method: "POST",
    path: "/v1/cloud/workers/desktop/revoke",
    body: { desktopInstallId },
  });
}
