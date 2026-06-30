import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import { legacyOpenApiClient } from "./legacy.js";
import type {
  SendSupportMessageRequest,
  SupportMessageContext,
  SupportReportCompleteRequest,
  SupportReportCompleteResponse,
  SupportReportCreateRequest,
  SupportReportCreateResponse,
  SupportReportUploadRequest,
  SupportReportUploadResponse,
  SupportReportTrackerResponse,
  SupportReportUploadTargetsRequest,
} from "../types/index.js";

export type {
  SendSupportMessageRequest,
  SupportMessageContext,
  SupportReportCompleteRequest,
  SupportReportCompleteResponse,
  SupportReportCreateRequest,
  SupportReportCreateResponse,
  SupportReportTrackerResponse,
  SupportReportUploadRequest,
  SupportReportUploadResponse,
  SupportReportUploadTargetsRequest,
};

export async function sendSupportMessage(
  input: SendSupportMessageRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await legacyOpenApiClient(client).POST("/v1/support/messages", { body: input });
}

export async function createSupportReportUpload(
  input: SupportReportUploadRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SupportReportUploadResponse> {
  const response = await legacyOpenApiClient(client).POST("/v1/support/report-uploads", { body: input });
  return response.data as SupportReportUploadResponse;
}

export async function createSupportReport(
  input: SupportReportCreateRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SupportReportCreateResponse> {
  const response = await legacyOpenApiClient(client).POST("/v1/support/reports", { body: input });
  return response.data as SupportReportCreateResponse;
}

export async function createSupportReportUploadTargets(
  reportId: string,
  input: SupportReportUploadTargetsRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SupportReportUploadResponse> {
  const response = await legacyOpenApiClient(client).POST("/v1/support/reports/{report_id}/upload-targets", {
    params: {
      path: {
        report_id: reportId,
      },
    },
    body: input,
  });
  return response.data as SupportReportUploadResponse;
}

export async function completeSupportReportUpload(
  reportId: string,
  input: SupportReportCompleteRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SupportReportCompleteResponse> {
  const response = await legacyOpenApiClient(client).POST("/v1/support/reports/{report_id}/complete", {
    params: {
      path: {
        report_id: reportId,
      },
    },
    body: input,
  });
  return response.data as SupportReportCompleteResponse;
}

export async function ensureSupportReportTracker(
  reportId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SupportReportTrackerResponse> {
  const response = await legacyOpenApiClient(client).POST("/v1/support/reports/{report_id}/tracker", {
    params: {
      path: {
        report_id: reportId,
      },
    },
  });
  return response.data as SupportReportTrackerResponse;
}
