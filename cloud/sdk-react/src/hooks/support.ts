import {
  completeSupportReportUpload as completeSupportReportUploadWithClient,
  createSupportReport as createSupportReportWithClient,
  ensureSupportReportTracker as ensureSupportReportTrackerWithClient,
  type SupportReportCompleteRequest,
  type SupportReportCompleteResponse,
  type SupportReportCreateRequest,
  type SupportReportCreateResponse,
  type SupportReportTrackerResponse,
} from "@proliferate/cloud-sdk";
import { useCallback, useMemo } from "react";
import { useCloudClient } from "../context/CloudClientProvider.js";

export interface CloudSupportReportActions {
  createSupportReport: (
    input: SupportReportCreateRequest,
  ) => Promise<SupportReportCreateResponse>;
  completeSupportReportUpload: (
    reportId: string,
    input: SupportReportCompleteRequest,
  ) => Promise<SupportReportCompleteResponse>;
  ensureSupportReportTracker: (
    reportId: string,
  ) => Promise<SupportReportTrackerResponse>;
}

export function useCloudSupportReportActions(): CloudSupportReportActions {
  const client = useCloudClient();

  const createSupportReport = useCallback(
    (input: SupportReportCreateRequest) =>
      createSupportReportWithClient(input, client),
    [client],
  );
  const completeSupportReportUpload = useCallback(
    (reportId: string, input: SupportReportCompleteRequest) =>
      completeSupportReportUploadWithClient(reportId, input, client),
    [client],
  );
  const ensureSupportReportTracker = useCallback(
    (reportId: string) => ensureSupportReportTrackerWithClient(reportId, client),
    [client],
  );

  return useMemo(
    () => ({
      createSupportReport,
      completeSupportReportUpload,
      ensureSupportReportTracker,
    }),
    [
      completeSupportReportUpload,
      createSupportReport,
      ensureSupportReportTracker,
    ],
  );
}
