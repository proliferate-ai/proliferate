import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopSupportSnapshotBridge } from "@proliferate/product-client/host/desktop-bridge";
import type { SupportReportJob } from "#product/lib/domain/support/report-types";

import {
  legacyConsentRequired,
  uploadSupportReportAttempt,
} from "./support-report-upload-attempt";
import { sha256Hex } from "./support-report-upload-payload";

const trace: string[] = [];
const uploadedBodies: BodyInit[] = [];
const cloud = vi.hoisted(() => ({
  createSupportReport: vi.fn(),
  createSupportReportUploadTargets: vi.fn(),
  completeSupportReportUpload: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk/client/support", () => cloud);

describe("prepared support report upload attempt", () => {
  beforeEach(() => {
    trace.length = 0;
    uploadedBodies.length = 0;
    cloud.createSupportReport.mockImplementation(async () => {
      trace.push("server:create");
      return createResponse("created");
    });
    cloud.createSupportReportUploadTargets.mockImplementation(async () => {
      trace.push("server:targets");
      return {
        reportId: "report-1",
        diagnostics: {
          objectKey: "private/report-1/diagnostics.json",
          putUrl: "https://uploads.example/diagnostics",
          contentType: "application/json",
          headers: {},
        },
        attachments: [],
      };
    });
    cloud.completeSupportReportUpload.mockImplementation(async () => {
      trace.push("server:complete");
      return { ok: true, reportId: "report-1" };
    });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      trace.push("server:put");
      expect(init.body).toBeInstanceOf(Blob);
      if (init.body) uploadedBodies.push(init.body);
      return { ok: true };
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("verifies one staged Blob before create and reuses it through completion", async () => {
    const bytes = new TextEncoder().encode('{"schemaVersion":3}');
    const sha256 = await sha256Hex(bytes.buffer as ArrayBuffer);
    const bridge = snapshotBridge(bytes);
    const job = preparedJob(bytes.byteLength, sha256);
    const retainedBytes: Blob[] = [];

    await expect(uploadSupportReportAttempt({
      job,
      attempt: 1,
      diagnostics: null,
      supportSnapshot: bridge,
      telemetry: telemetry(),
      retainBytes(blob) {
        retainedBytes.push(blob);
      },
      onLifecycleError: vi.fn(),
    })).resolves.toEqual({ reportId: "report-1" });

    expect(trace).toEqual([
      "native:read",
      "native:begin",
      "server:create",
      "server:targets",
      "server:put",
      "server:complete",
      "native:finish:succeeded",
    ]);
    expect(bridge.readArtifact).toHaveBeenCalledTimes(1);
    expect(retainedBytes).toHaveLength(1);
    expect(uploadedBodies).toEqual([retainedBytes[0]]);
    expect(cloud.createSupportReportUploadTargets).toHaveBeenCalledWith(
      "report-1",
      expect.objectContaining({
        diagnostics: {
          contentType: "application/json",
          sizeBytes: bytes.byteLength,
          sha256,
        },
      }),
    );
  });

  it("makes no native lifecycle or server call when the artifact is missing", async () => {
    const bytes = new TextEncoder().encode("{}");
    const sha256 = await sha256Hex(bytes.buffer as ArrayBuffer);
    const bridge = snapshotBridge(bytes);
    bridge.readArtifact.mockRejectedValueOnce(Object.assign(new Error("not found"), {
      code: "artifact_missing",
    }));

    await expect(uploadSupportReportAttempt({
      job: preparedJob(bytes.byteLength, sha256),
      attempt: 1,
      diagnostics: null,
      supportSnapshot: bridge,
      telemetry: telemetry(),
      retainBytes: vi.fn(),
      onLifecycleError: vi.fn(),
    })).rejects.toMatchObject({ code: "snapshot_missing" });
    expect(bridge.beginSubmission).not.toHaveBeenCalled();
    expect(cloud.createSupportReport).not.toHaveBeenCalled();
  });

  it("makes no native lifecycle or server call when staged bytes mismatch", async () => {
    const bytes = new TextEncoder().encode("{}");
    const bridge = snapshotBridge(bytes);

    await expect(uploadSupportReportAttempt({
      job: preparedJob(bytes.byteLength, "0".repeat(64)),
      attempt: 1,
      diagnostics: null,
      supportSnapshot: bridge,
      telemetry: telemetry(),
      retainBytes: vi.fn(),
      onLifecycleError: vi.fn(),
    })).rejects.toMatchObject({ code: "snapshot_mismatch" });
    expect(bridge.beginSubmission).not.toHaveBeenCalled();
    expect(cloud.createSupportReport).not.toHaveBeenCalled();
  });

  it("maps ordinary admitted transport failure to the closed transient terminal", async () => {
    const bytes = new TextEncoder().encode("{}");
    const sha256 = await sha256Hex(bytes.buffer as ArrayBuffer);
    const bridge = snapshotBridge(bytes);
    cloud.createSupportReport.mockRejectedValueOnce(new Error("Upload failed with 504."));

    await expect(uploadSupportReportAttempt({
      job: preparedJob(bytes.byteLength, sha256),
      attempt: 2,
      diagnostics: null,
      supportSnapshot: bridge,
      telemetry: telemetry(),
      retainBytes: vi.fn(),
      onLifecycleError: vi.fn(),
    })).rejects.toThrow("504");
    expect(bridge.finishSubmission).toHaveBeenCalledWith({
      submissionId: "submission-1",
      outcome: "failed",
      errorClassification: "transient",
      reportId: null,
    });
  });

  it("reports a lifecycle finish failure without changing a completed upload", async () => {
    const bytes = new TextEncoder().encode("{}");
    const sha256 = await sha256Hex(bytes.buffer as ArrayBuffer);
    const bridge = snapshotBridge(bytes);
    const lifecycleError = new Error("native lifecycle unavailable");
    const onLifecycleError = vi.fn();
    bridge.finishSubmission.mockRejectedValueOnce(lifecycleError);

    await expect(uploadSupportReportAttempt({
      job: preparedJob(bytes.byteLength, sha256),
      attempt: 1,
      diagnostics: null,
      supportSnapshot: bridge,
      telemetry: telemetry(),
      retainBytes: vi.fn(),
      onLifecycleError,
    })).resolves.toEqual({ reportId: "report-1" });
    expect(onLifecycleError).toHaveBeenCalledWith(lifecycleError);
  });

  it("rereads the same artifact for a retry without invoking preparation", async () => {
    const bytes = new TextEncoder().encode("{}");
    const sha256 = await sha256Hex(bytes.buffer as ArrayBuffer);
    const bridge = snapshotBridge(bytes);
    const job = preparedJob(bytes.byteLength, sha256);
    cloud.createSupportReport.mockRejectedValueOnce(new Error("offline"));

    await expect(uploadSupportReportAttempt({
      job,
      attempt: 1,
      diagnostics: null,
      supportSnapshot: bridge,
      telemetry: telemetry(),
      retainBytes: vi.fn(),
      onLifecycleError: vi.fn(),
    })).rejects.toThrow("offline");
    await expect(uploadSupportReportAttempt({
      job,
      attempt: 2,
      diagnostics: null,
      supportSnapshot: bridge,
      telemetry: telemetry(),
      retainBytes: vi.fn(),
      onLifecycleError: vi.fn(),
    })).resolves.toEqual({ reportId: "report-1" });

    expect(bridge.readArtifact).toHaveBeenCalledTimes(2);
    expect(bridge.beginSubmission).toHaveBeenCalledTimes(2);
    expect(bridge.beginPreparation).not.toHaveBeenCalled();
    expect(bridge.finishPreparation).not.toHaveBeenCalled();
  });

  it("admits a verified prepared attempt before rejecting invalid local attachment intent", async () => {
    const bytes = new TextEncoder().encode("{}");
    const sha256 = await sha256Hex(bytes.buffer as ArrayBuffer);
    const bridge = snapshotBridge(bytes);
    const job = preparedJob(bytes.byteLength, sha256);
    job.attachments = [{
      clientFileId: "too-large",
      fileName: "huge.bin",
      contentType: "application/octet-stream",
      sizeBytes: 25 * 1024 * 1024 + 1,
      dataBase64: "AA==",
    }];

    await expect(uploadSupportReportAttempt({
      job,
      attempt: 1,
      diagnostics: null,
      supportSnapshot: bridge,
      telemetry: telemetry(),
      retainBytes: vi.fn(),
      onLifecycleError: vi.fn(),
    })).rejects.toThrow("Attachment is too large");
    expect(bridge.beginSubmission).toHaveBeenCalledTimes(1);
    expect(bridge.finishSubmission).toHaveBeenCalledWith({
      submissionId: "submission-1",
      outcome: "rejected",
      errorClassification: "local_payload_invalid",
      reportId: null,
    });
    expect(cloud.createSupportReport).not.toHaveBeenCalled();
  });

  it("completes a new no-snapshot report without requesting upload targets", async () => {
    const job = preparedJob(2, "b".repeat(64));
    job.supportSnapshot = { kind: "none" };
    const reportTelemetry = telemetry();

    await expect(uploadSupportReportAttempt({
      job,
      attempt: 1,
      diagnostics: null,
      supportSnapshot: null,
      telemetry: reportTelemetry,
      retainBytes: vi.fn(),
      onLifecycleError: vi.fn(),
    })).resolves.toEqual({ reportId: "report-1" });
    expect(cloud.createSupportReportUploadTargets).not.toHaveBeenCalled();
    expect(reportTelemetry.track).toHaveBeenCalledWith(
      "support_report_submitted",
      expect.objectContaining({ diagnostics_included: false }),
    );
  });

  it("recognizes only the legacy diagnostics-intent conflict as fresh-consent terminal", async () => {
    const job = preparedJob(2, "b".repeat(64));
    job.supportSnapshot = { kind: "none" };
    job.includeLogs = true;
    const conflict = Object.assign(
      new Error("Support report upload targets changed diagnostics intent."),
      { code: "support_report_upload_conflict", status: 400 },
    );
    cloud.createSupportReportUploadTargets.mockRejectedValueOnce(conflict);

    let caught: unknown;
    try {
      await uploadSupportReportAttempt({
        job,
        attempt: 1,
        diagnostics: null,
        supportSnapshot: null,
        telemetry: telemetry(),
        retainBytes: vi.fn(),
        onLifecycleError: vi.fn(),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(conflict);
    expect(legacyConsentRequired(caught, job)).toBe(true);
    expect(trace).not.toContain("native:begin");
  });

  it("keeps an already-completed truthy legacy job queue-only", async () => {
    const job = preparedJob(2, "b".repeat(64));
    job.supportSnapshot = { kind: "none" };
    job.includeLogs = true;
    cloud.createSupportReport.mockResolvedValueOnce(createResponse("completed"));

    let caught: unknown;
    try {
      await uploadSupportReportAttempt({
        job,
        attempt: 2,
        diagnostics: null,
        supportSnapshot: null,
        telemetry: telemetry(),
        retainBytes: vi.fn(),
        onLifecycleError: vi.fn(),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "consent_required_for_legacy_job" });
    expect(legacyConsentRequired(caught, job)).toBe(true);
    expect(cloud.createSupportReportUploadTargets).not.toHaveBeenCalled();
    expect(trace).not.toContain("native:begin");
  });
});

function snapshotBridge(bytes: Uint8Array) {
  return {
    beginPreparation: vi.fn(),
    finishPreparation: vi.fn(),
    cancelPreparation: vi.fn(),
    saveArchive: vi.fn(),
    readArtifact: vi.fn(async () => {
      trace.push("native:read");
      return toBase64(bytes);
    }),
    deleteArtifact: vi.fn(),
    reconcileArtifacts: vi.fn(),
    beginSubmission: vi.fn(async () => {
      trace.push("native:begin");
      return { submissionId: "submission-1", operationId: "operation-1" };
    }),
    finishSubmission: vi.fn(async (input) => {
      trace.push(`native:finish:${input.outcome}`);
    }),
  } satisfies DesktopSupportSnapshotBridge;
}

function preparedJob(sizeBytes: number, sha256: string): SupportReportJob {
  return {
    jobId: "10000000-0000-4000-8000-000000000001",
    createdAt: "2026-08-12T00:00:00.000Z",
    message: "Help",
    scope: { kind: "app_only", workspaceIds: [] },
    publicContentConsent: false,
    kind: "bug",
    creditConsent: false,
    supportSnapshot: {
      kind: "prepared",
      consent: {
        version: 1,
        disclosureVersion: "desktop_support_snapshot_customer_content_v1",
        grantedAt: "2026-08-12T00:00:00.000Z",
        selection: {
          kind: "recent_activity",
          workspace: { kind: "none", reason: "no_selected_bundled_local_workspace" },
        },
      },
      artifact: {
        artifactSchemaVersion: 3,
        artifactId: `ssv1_${"a".repeat(64)}`,
        snapshotId: "20000000-0000-4000-8000-000000000001",
        preparationOperationId: "30000000-0000-4000-8000-000000000001",
        generatedAt: "2026-08-12T00:00:00.000Z",
        sizeBytes,
        sha256,
        summary: {
          collectorRecords: 0,
          fallbackRecords: 0,
          sessions: 0,
          omissions: 0,
          truncations: 0,
        },
      },
    },
    snapshot: {
      openedAt: "2026-08-12T00:00:00.000Z",
      source: "sidebar",
      context: { source: "sidebar", intent: "general" },
      defaultScope: "app_only",
      defaultWorkspaceId: null,
      workspaceOptions: [],
    },
    attachments: [],
  };
}

function telemetry() {
  return {
    track: vi.fn(),
    getSupportContext: () => ({
      clientReleaseId: "proliferate-desktop@0.0.0+abcdef012345",
      telemetryRefs: {},
    }),
  };
}

function createResponse(status: string) {
  return {
    reportId: "report-1",
    clientJobId: "10000000-0000-4000-8000-000000000001",
    status,
    cloudDiagnosticsStatus: "not_applicable",
    serverCorrelation: {
      reportId: "report-1",
      requestId: "request-1",
      ownerUserId: "user-1",
      primaryOrganizationId: null,
      primaryTenantId: "user:user-1",
      tenantIds: ["user:user-1"],
      cloudWorkspaceIds: [],
      cloudTargetIds: [],
      anyharnessWorkspaceIds: [],
      sessionIds: [],
    },
  };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
