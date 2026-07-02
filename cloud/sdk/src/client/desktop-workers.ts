import { getProliferateClient, type ProliferateCloudClient } from "./core.js";

export interface DesktopWorkerEnrollmentResponse {
  enrollmentToken: string;
  expiresAt: string;
}

export async function enrollDesktopWorker(
  desktopInstallId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<DesktopWorkerEnrollmentResponse> {
  return client.requestJson<DesktopWorkerEnrollmentResponse>({
    method: "POST",
    path: "/v1/cloud/workers/desktop/enrollment",
    body: { desktopInstallId },
  });
}
