import type { SupportMessageContext } from "@proliferate/cloud-sdk";
import { useCloudSupportReportActions } from "@proliferate/cloud-sdk-react";
import type { SupportSurfaceSubmitInput } from "@proliferate/product-ui/support/SupportSurface";
import { SupportSurface } from "@proliferate/product-ui/support/SupportSurface";

export interface CloudSupportSurfaceProps {
  context: SupportMessageContext;
  /**
   * Canonical `<component>@<semver>+<12-hex-sha>` release identifier for the
   * calling app. Passed in from the app layer (e.g. web's
   * `getWebTelemetryConfig().release`) since this shared package cannot
   * import app-specific telemetry config directly.
   */
  releaseId?: string | null;
}

export function CloudSupportSurface({ context, releaseId }: CloudSupportSurfaceProps) {
  const { submitSupportReport: submitCloudSupportReport } = useCloudSupportReportActions();

  async function submitSupportReport(input: SupportSurfaceSubmitInput) {
    await submitCloudSupportReport({
      message: input.message,
      publicContentConsent: input.publicContentConsent,
      context,
      sourceSurface: "web",
      clientReleaseId: releaseId ?? null,
    });
  }

  return (
    <SupportSurface
      onSubmit={submitSupportReport}
    />
  );
}
