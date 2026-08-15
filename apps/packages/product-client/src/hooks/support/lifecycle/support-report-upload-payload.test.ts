import { describe, expect, it } from "vitest";
import type { ProductSupportTelemetryContext } from "@proliferate/product-client/host/product-host";
import type { SupportReportJob } from "#product/lib/domain/support/report-types";

import {
  buildCreateReportRequest,
  completeRequestForUpload,
} from "#product/hooks/support/lifecycle/support-report-upload-payload";

// The support context now arrives injected from the product telemetry facade,
// standing in for the values Desktop previously read from the telemetry client.
const supportContext: ProductSupportTelemetryContext = {
  clientReleaseId: "proliferate-desktop@0.3.27+abcdef012345",
  telemetryRefs: {},
};

function makeJob(overrides: Partial<SupportReportJob> = {}): SupportReportJob {
  return {
    jobId: "job-1",
    createdAt: "2026-07-05T00:00:00.000Z",
    message: "Something broke",
    scope: { kind: "app_only", workspaceIds: [] },
    publicContentConsent: false,
    kind: "bug",
    creditConsent: false,
    supportSnapshot: { kind: "none" },
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
  it("carries urgent / notifyMe and declares diagnostics only for prepared intent", () => {
    const request = buildCreateReportRequest(makeJob({ urgent: true, notifyMe: true }), 0, supportContext);
    expect(request.urgent).toBe(true);
    expect(request.notifyMe).toBe(true);
    expect(request.expectedClientUploads?.diagnostics).toBe(false);
  });

  it("never treats legacy includeLogs truthiness as consent", () => {
    const request = buildCreateReportRequest(makeJob({ includeLogs: true }), 0, supportContext);
    expect(request.expectedClientUploads?.diagnostics).toBe(false);
  });

  it("declares diagnostics for an exact prepared snapshot", () => {
    const request = buildCreateReportRequest(makeJob({
      supportSnapshot: preparedSnapshotIntent(),
    }), 0, supportContext);
    expect(request.expectedClientUploads?.diagnostics).toBe(true);
  });

  it("defaults urgent/notifyMe to false for legacy persisted jobs", () => {
    const request = buildCreateReportRequest(makeJob(), 2, supportContext);
    expect(request.urgent).toBe(false);
    expect(request.notifyMe).toBe(false);
    expect(request.expectedClientUploads?.diagnostics).toBe(false);
    expect(request.expectedClientUploads?.attachmentCount).toBe(2);
  });

  it("passes credit name only when consented", () => {
    expect(buildCreateReportRequest(makeJob({ creditConsent: true, creditName: "Ada" }), 0, supportContext).creditName)
      .toBe("Ada");
    expect(buildCreateReportRequest(makeJob(), 0, supportContext).creditName).toBeNull();
  });

  it("populates clientReleaseId from the desktop telemetry release accessor", () => {
    const request = buildCreateReportRequest(makeJob(), 0, supportContext);
    expect(request.clientReleaseId).toBe("proliferate-desktop@0.3.27+abcdef012345");
  });
});

function preparedSnapshotIntent(): Extract<SupportReportJob["supportSnapshot"], { kind: "prepared" }> {
  return {
    kind: "prepared",
    consent: {
      version: 1,
      disclosureVersion: "desktop_support_snapshot_customer_content_v1",
      grantedAt: "2026-07-05T00:00:00.000Z",
      selection: {
        kind: "recent_activity",
        workspace: { kind: "none", reason: "no_selected_bundled_local_workspace" },
      },
    },
    artifact: {
      artifactSchemaVersion: 3,
      artifactId: `ssv1_${"a".repeat(64)}`,
      snapshotId: "snapshot-1",
      preparationOperationId: "operation-1",
      generatedAt: "2026-07-05T00:00:00.000Z",
      sizeBytes: 2,
      sha256: "b".repeat(64),
      summary: {
        collectorRecords: 0,
        fallbackRecords: 0,
        sessions: 0,
        omissions: 0,
        truncations: 0,
      },
    },
  };
}

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
