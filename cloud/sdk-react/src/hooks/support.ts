import {
  completeSupportReportUpload as completeSupportReportUploadWithClient,
  createSupportReport as createSupportReportWithClient,
  ensureSupportReportTracker as ensureSupportReportTrackerWithClient,
  type SupportMessageContext,
  type SupportReportCreateRequest,
} from "@proliferate/cloud-sdk";
import { useCallback, useMemo, useRef } from "react";
import { useCloudClient } from "../context/CloudClientProvider.js";

export interface CloudSupportReportSubmitInput {
  message: string;
  publicContentConsent: boolean;
  context: SupportMessageContext;
  sourceSurface: SupportReportCreateRequest["sourceSurface"];
}

export interface CloudSupportReportActions {
  submitSupportReport: (input: CloudSupportReportSubmitInput) => Promise<void>;
}

export function useCloudSupportReportActions(): CloudSupportReportActions {
  const client = useCloudClient();
  const clientJobIdRef = useRef<string | null>(null);

  const submitSupportReport = useCallback(
    async (input: CloudSupportReportSubmitInput) => {
      const clientJobId = clientJobIdRef.current ?? crypto.randomUUID();
      clientJobIdRef.current = clientJobId;
      const report = await createSupportReportWithClient(
        {
          clientJobId,
          message: input.message,
          sourceSurface: input.sourceSurface,
          context: input.context,
          scope: {
            kind: "app_only",
            workspaceIds: [],
          },
          workspaceRefs: [],
          expectedClientUploads: {
            diagnostics: false,
            attachmentCount: 0,
          },
          publicContentConsent: input.publicContentConsent,
          kind: "bug",
          creditConsent: false,
        },
        client,
      );
      if (report.status !== "completed") {
        await completeSupportReportUploadWithClient(
          report.reportId,
          {
            diagnostics: null,
            attachments: [],
            packageManifest: {
              schemaVersion: 1,
              clientJobId,
              reportId: report.reportId,
              sourceSurface: input.sourceSurface,
            },
          },
          client,
        );
      }
      clientJobIdRef.current = null;
      void ensureSupportReportTrackerWithClient(report.reportId, client).catch(() => undefined);
    },
    [client],
  );

  return useMemo(
    () => ({
      submitSupportReport,
    }),
    [submitSupportReport],
  );
}
