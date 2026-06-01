import type { SupportMessageContext } from "@proliferate/cloud-sdk";
import { useCloudSupportReportActions } from "@proliferate/cloud-sdk-react";
import type { SupportSurfaceSubmitInput } from "@proliferate/product-ui/support/SupportSurface";
import { SupportSurface } from "@proliferate/product-ui/support/SupportSurface";

export interface CloudSupportSurfaceProps {
  context: SupportMessageContext;
}

export function CloudSupportSurface({ context }: CloudSupportSurfaceProps) {
  const { submitSupportReport: submitCloudSupportReport } = useCloudSupportReportActions();

  async function submitSupportReport(input: SupportSurfaceSubmitInput) {
    await submitCloudSupportReport({
      message: input.message,
      publicContentConsent: input.publicContentConsent,
      context,
      sourceSurface: "web",
    });
  }

  return (
    <SupportSurface
      onSubmit={submitSupportReport}
    />
  );
}
