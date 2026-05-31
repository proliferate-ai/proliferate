import { describe, expect, it } from "vitest";
import {
  describeSupportReportUploadFailure,
  shouldShowSupportReportUploadFailureToast,
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
