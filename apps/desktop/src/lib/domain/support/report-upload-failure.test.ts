import { describe, expect, it } from "vitest";
import {
  describeSupportReportUploadFailure,
  shouldShowSupportReportUploadFailureToast,
  supportReportRetriesExhausted,
} from "./report-upload-failure";

describe("describeSupportReportUploadFailure", () => {
  it("surfaces missing Cloud sign-in as an actionable queued failure", () => {
    const failure = describeSupportReportUploadFailure(
      {
        message: "You must sign in to use cloud workspaces.",
        status: 401,
        code: "unauthorized",
      },
      1,
    );

    expect(failure).toMatchObject({
      kind: "auth_required",
      retryable: true,
      retryDelayMs: 5 * 60_000,
      toastMessage: "Sign in to Proliferate Cloud to send support reports. Report is queued.",
    });
  });

  it("surfaces dev auth bypass distinctly from expired sign-in", () => {
    const failure = describeSupportReportUploadFailure(
      {
        message: "Cloud workspaces require real sign-in.",
        status: 401,
        code: "dev_auth_bypass",
      },
      1,
    );

    expect(failure).toMatchObject({
      kind: "dev_auth_bypass",
      retryable: true,
      retryDelayMs: 30 * 60_000,
      toastMessage: "Support reports need real Cloud sign-in. Disable dev auth bypass first.",
    });
  });

  it("surfaces missing support storage config without generic retry copy", () => {
    const failure = describeSupportReportUploadFailure(
      {
        message: "Support report upload storage is not configured.",
        status: 503,
        code: "support_report_storage_unavailable",
      },
      3,
    );

    expect(failure).toMatchObject({
      kind: "storage_unconfigured",
      retryable: true,
      retryDelayMs: 30 * 60_000,
      toastMessage: "Support uploads are not configured for this server. Report is queued.",
    });
  });

  it("does not retry local payload failures that the queue cannot repair", () => {
    const failure = describeSupportReportUploadFailure(
      new Error("Attachment is too large: screenshot.png"),
      1,
    );

    expect(failure).toMatchObject({
      kind: "local_payload_invalid",
      retryable: false,
      retryDelayMs: null,
      toastMessage: "Report is too large or missing attachment data. Try again with fewer files.",
    });
  });

  it("keeps generic transient upload failures retryable", () => {
    const failure = describeSupportReportUploadFailure(new Error("Upload failed with 503."), 2);

    expect(failure).toMatchObject({
      kind: "transient",
      retryable: true,
      retryDelayMs: 5 * 60_000,
      toastMessage: "Report could not be sent. We'll retry in the background.",
    });
  });

  it("treats a locked upload-target conflict as terminal instead of transient", () => {
    const failure = describeSupportReportUploadFailure(
      new Error("Support report upload targets already exist for different objects."),
      379,
    );

    expect(failure).toMatchObject({
      kind: "upload_conflict",
      retryable: false,
      retryDelayMs: null,
    });
  });

  it("treats a changed-intent conflict as terminal", () => {
    const failure = describeSupportReportUploadFailure(
      new Error("Support report upload targets changed attachment intent."),
      4,
    );

    expect(failure.kind).toBe("upload_conflict");
    expect(failure.retryable).toBe(false);
  });

  it("classifies the stable conflict code as terminal regardless of message", () => {
    const failure = describeSupportReportUploadFailure(
      { message: "reworded server prose", code: "support_report_upload_conflict" },
      2,
    );

    expect(failure.kind).toBe("upload_conflict");
    expect(failure.retryable).toBe(false);
  });

  it("treats an already-completed report as benign success, not a conflict", () => {
    const byCode = describeSupportReportUploadFailure(
      { message: "reworded", code: "support_report_already_completed" },
      2,
    );
    const byMessage = describeSupportReportUploadFailure(
      new Error("Support report upload is already completed."),
      2,
    );

    for (const failure of [byCode, byMessage]) {
      expect(failure.kind).toBe("already_completed");
      expect(failure.retryable).toBe(false);
    }
  });

  it("treats other upload-invalid 400s as terminal rejections, not transient retries", () => {
    const failure = describeSupportReportUploadFailure(
      {
        message: "Diagnostics payload is too large.",
        code: "support_report_upload_invalid",
        status: 400,
      },
      2,
    );

    expect(failure.kind).toBe("upload_rejected");
    expect(failure.retryable).toBe(false);
  });
});

describe("supportReportRetriesExhausted", () => {
  const now = Date.parse("2026-06-17T00:00:00.000Z");

  it("attempt-caps transient failures exactly at the boundary", () => {
    expect(supportReportRetriesExhausted({ kind: "transient", attemptCount: 8, nowMs: now }))
      .toBe(true);
    expect(supportReportRetriesExhausted({ kind: "transient", attemptCount: 7, nowMs: now }))
      .toBe(false);
  });

  it("does not attempt-cap blocked-on-user states while they are still fresh", () => {
    expect(supportReportRetriesExhausted({
      kind: "auth_required",
      attemptCount: 50,
      createdAt: "2026-06-16T18:00:00.000Z",
      nowMs: now,
    })).toBe(false);
  });

  it("age-caps every retryable failure once stale, including blocked states", () => {
    for (const kind of ["transient", "auth_required", "storage_unconfigured"] as const) {
      expect(supportReportRetriesExhausted({
        kind,
        attemptCount: 1,
        createdAt: "2026-06-02T00:00:00.000Z",
        nowMs: now,
      })).toBe(true);
    }
  });

  it("keeps retrying a fresh job within budget and age", () => {
    expect(supportReportRetriesExhausted({
      kind: "transient",
      attemptCount: 2,
      createdAt: "2026-06-16T18:00:00.000Z",
      nowMs: now,
    })).toBe(false);
  });
});

describe("shouldShowSupportReportUploadFailureToast", () => {
  it("shows the first toast for a failure kind", () => {
    const failure = describeSupportReportUploadFailure(
      { message: "You must sign in.", status: 401, code: "unauthorized" },
      1,
    );

    expect(shouldShowSupportReportUploadFailureToast({
      failure,
      nowMs: Date.parse("2026-05-31T10:00:00.000Z"),
    })).toBe(true);
  });

  it("suppresses repeated queued-auth toasts inside the cooldown", () => {
    const failure = describeSupportReportUploadFailure(
      { message: "You must sign in.", status: 401, code: "unauthorized" },
      2,
    );

    expect(shouldShowSupportReportUploadFailureToast({
      failure,
      lastToastAt: "2026-05-31T10:00:00.000Z",
      lastToastKind: "auth_required",
      nowMs: Date.parse("2026-05-31T10:10:00.000Z"),
    })).toBe(false);
  });

  it("shows a toast again after the failure kind changes", () => {
    const failure = describeSupportReportUploadFailure(
      {
        message: "Support report upload storage is not configured.",
        code: "support_report_storage_unavailable",
      },
      2,
    );

    expect(shouldShowSupportReportUploadFailureToast({
      failure,
      lastToastAt: "2026-05-31T10:00:00.000Z",
      lastToastKind: "auth_required",
      nowMs: Date.parse("2026-05-31T10:10:00.000Z"),
    })).toBe(true);
  });
});
