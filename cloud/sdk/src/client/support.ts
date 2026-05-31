import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  SendSupportMessageRequest,
  SupportMessageContext,
  SupportReportCompleteRequest,
  SupportReportCompleteResponse,
  SupportReportUploadRequest,
  SupportReportUploadResponse,
} from "../types/index.js";

export type {
  SendSupportMessageRequest,
  SupportMessageContext,
  SupportReportCompleteRequest,
  SupportReportCompleteResponse,
  SupportReportUploadRequest,
  SupportReportUploadResponse,
};

export async function sendSupportMessage(
  input: SendSupportMessageRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await client.POST("/v1/support/messages", { body: input });
}

export async function createSupportReportUpload(
  input: SupportReportUploadRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SupportReportUploadResponse> {
  const response = await client.POST("/v1/support/report-uploads", { body: input });
  return response.data as SupportReportUploadResponse;
}

export async function completeSupportReportUpload(
  reportId: string,
  input: SupportReportCompleteRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SupportReportCompleteResponse> {
  const response = await client.POST("/v1/support/reports/{report_id}/complete", {
    params: {
      path: {
        report_id: reportId,
      },
    },
    body: input,
  });
  return response.data as SupportReportCompleteResponse;
}
