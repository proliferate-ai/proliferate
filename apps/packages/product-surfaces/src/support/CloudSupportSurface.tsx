import type { SupportMessageContext } from "@proliferate/cloud-sdk";
import { useCloudSupportReportActions } from "@proliferate/cloud-sdk-react";
import type { SupportSurfaceSubmitInput } from "@proliferate/product-ui/support/SupportSurface";
import { SupportSurface } from "@proliferate/product-ui/support/SupportSurface";
import { useRef } from "react";

export interface CloudSupportSurfaceProps {
  context: SupportMessageContext;
}

export function CloudSupportSurface({ context }: CloudSupportSurfaceProps) {
  const {
    completeSupportReportUpload,
    createSupportReport,
    ensureSupportReportTracker,
  } = useCloudSupportReportActions();
  const clientJobIdRef = useRef<string | null>(null);

  async function submitSupportReport(input: SupportSurfaceSubmitInput) {
    const clientJobId = clientJobIdRef.current ?? crypto.randomUUID();
    clientJobIdRef.current = clientJobId;
    const report = await createSupportReport(
      {
        clientJobId,
        message: input.message,
        sourceSurface: "web",
        context,
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
      },
    );
    if (report.status !== "completed") {
      await completeSupportReportUpload(
        report.reportId,
        {
          diagnostics: null,
          attachments: [],
          packageManifest: {
            schemaVersion: 1,
            clientJobId,
            reportId: report.reportId,
            sourceSurface: "web",
          },
        },
      );
    }
    clientJobIdRef.current = null;
    void ensureSupportReportTracker(report.reportId).catch(() => undefined);
    return undefined;
  }

  return (
    <SupportSurface
      onSubmit={submitSupportReport}
    />
  );
}
