import { describe, expect, it, vi } from "vitest";
import type { SupportReportJob } from "@/lib/domain/support/report-types";

vi.mock("@/lib/integrations/telemetry/client", () => ({
  getSupportReportTelemetryRefs: () => ({}),
  getSupportReportReleaseId: () => "proliferate-desktop@0.3.27+abcdef012345",
  trackProductEvent: vi.fn(),
}));

vi.mock("@/lib/access/tauri/support", () => ({
  readStagedSupportReportAttachment: vi.fn(async () => ""),
}));

import {
  buildCreateReportRequest,
  completeRequestForUpload,
} from "./support-report-upload-payload";

function makeJob(overrides: Partial<SupportReportJob> = {}): SupportReportJob {
  return {
    jobId: "job-1",
    createdAt: "2026-07-05T00:00:00.000Z",
    message: "Something broke",
    scope: { kind: "app_only", workspaceIds: [] },
    publicContentConsent: false,
    kind: "bug",
    creditConsent: false,
    snapshot: {
      openedAt: "2026-07-05T00:00:00.000Z",
      source: "sidebar",
      context: { source: "sidebar", intent: "general" },
      defaultScope: "app_only",
      defaultWorkspaceId: null,
      workspaceOptions: [],
    },
    attachments: [],
    ...overrides,
  };
}

describe("buildCreateReportRequest", () => {
  it("carries urgent / notifyMe and diagnostics=true by default", () => {
    const request = buildCreateReportRequest(makeJob({ urgent: true, notifyMe: true }), 0);
    expect(request.urgent).toBe(true);
    expect(request.notifyMe).toBe(true);
    expect(request.expectedClientUploads?.diagnostics).toBe(true);
  });

  it("sets diagnostics=false when includeLogs is off", () => {
    const request = buildCreateReportRequest(makeJob({ includeLogs: false }), 0);
    expect(request.expectedClientUploads?.diagnostics).toBe(false);
  });

  it("defaults urgent/notifyMe to false for legacy persisted jobs", () => {
    const request = buildCreateReportRequest(makeJob(), 2);
    expect(request.urgent).toBe(false);
    expect(request.notifyMe).toBe(false);
    // Missing includeLogs defaults to logs-included.
    expect(request.expectedClientUploads?.diagnostics).toBe(true);
    expect(request.expectedClientUploads?.attachmentCount).toBe(2);
  });

  it("passes credit name only when consented", () => {
    expect(buildCreateReportRequest(makeJob({ creditConsent: true, creditName: "Ada" }), 0).creditName)
      .toBe("Ada");
    expect(buildCreateReportRequest(makeJob(), 0).creditName).toBeNull();
  });

  it("populates clientReleaseId from the desktop telemetry release accessor", () => {
    const request = buildCreateReportRequest(makeJob(), 0);
    expect(request.clientReleaseId).toBe("proliferate-desktop@0.3.27+abcdef012345");
  });
});

describe("completeRequestForUpload", () => {
  it("omits the diagnostics object when logs are excluded", () => {
    const request = completeRequestForUpload({
      job: makeJob({ includeLogs: false }),
      reportId: "report-1",
      diagnostics: undefined,
      generatedAt: "2026-07-05T00:00:00.000Z",
      cloudDiagnosticsStatus: "not_applicable",
      attachments: [],
    });
    expect(request.diagnostics).toBeNull();
    expect(request.packageManifest?.diagnosticsIncluded).toBe(false);
    expect(request.packageManifest?.diagnosticsBytes).toBe(0);
  });

  it("includes the diagnostics object when logs are present", () => {
    const request = completeRequestForUpload({
      job: makeJob(),
      reportId: "report-1",
      diagnostics: { objectKey: "k", sha256: "abc", sizeBytes: 123 },
      generatedAt: "2026-07-05T00:00:00.000Z",
      cloudDiagnosticsStatus: "not_applicable",
      attachments: [],
    });
    expect(request.diagnostics).toEqual({ objectKey: "k", sha256: "abc", sizeBytes: 123 });
    expect(request.packageManifest?.diagnosticsIncluded).toBe(true);
  });
});
