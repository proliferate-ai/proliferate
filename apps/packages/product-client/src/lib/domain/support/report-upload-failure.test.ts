import { describe, expect, it } from "vitest";
import {
  describeSupportReportUploadFailure,
  shouldShowSupportReportUploadFailureToast,
  SupportReportLocalPayloadError,
  SupportSnapshotArtifactError,
  supportReportRetriesExhausted,
} from "#product/lib/domain/support/report-upload-failure";

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
      new SupportReportLocalPayloadError("Attachment is too large: screenshot.png"),
      1,
    );

    expect(failure).toMatchObject({
      kind: "local_payload_invalid",
      retryable: false,
      retryDelayMs: null,
      toastMessage: "Report is too large or missing attachment data. Try again with fewer files.",
    });
  });

  it.each(["snapshot_missing", "snapshot_mismatch"] as const)(
    "keeps %s pre-submit and terminal",
    (code) => {
      const failure = describeSupportReportUploadFailure(
        new SupportSnapshotArtifactError(code),
        1,
      );
      expect(failure).toMatchObject({ kind: code, retryable: false, retryDelayMs: null });
    },
  );

  it("keeps generic transient upload failures retryable", () => {
    const failure = describeSupportReportUploadFailure(new Error("Upload failed with 503."), 2);

    expect(failure).toMatchObject({
      kind: "transient",
      retryable: true,
      retryDelayMs: 5 * 60_000,
      toastMessage: "Report could not be sent. We'll retry in the background.",
    });
  });

  it("does not fabricate a conflict from message-only prose", () => {
    const failure = describeSupportReportUploadFailure(
      new Error("Support report upload targets already exist for different objects."),
      379,
    );

    expect(failure).toMatchObject({
      kind: "transient",
      retryable: true,
    });
  });

  it("does not fabricate changed-intent or storage semantics from prose", () => {
    for (const message of [
      "Support report upload targets changed attachment intent.",
      "Support report upload storage is not configured.",
      "Attachment is too large: lookalike.png",
    ]) {
      expect(describeSupportReportUploadFailure(new Error(message), 4).kind).toBe("transient");
    }
  });

  it("classifies the stable conflict code as terminal regardless of message", () => {
    const failure = describeSupportReportUploadFailure(
      { message: "reworded server prose", code: "support_report_upload_conflict" },
      2,
    );

    expect(failure.kind).toBe("upload_conflict");
    expect(failure.retryable).toBe(false);
  });

  it("requires the stable code before treating a report as already completed", () => {
    const byCode = describeSupportReportUploadFailure(
      { message: "reworded", code: "support_report_already_completed" },
      2,
    );
    const byMessage = describeSupportReportUploadFailure(
      new Error("Support report upload is already completed."),
      2,
    );

    expect(byCode.kind).toBe("already_completed");
    expect(byCode.retryable).toBe(false);
    expect(byMessage.kind).toBe("transient");
    expect(byMessage.retryable).toBe(true);
  });

  it("classifies throwing accessors and revoked proxies without invoking traps", () => {
    const trapped = Object.defineProperties({}, {
      code: { get: () => { throw new Error("code trap"); } },
      message: { get: () => { throw new Error("message trap"); } },
      status: { get: () => { throw new Error("status trap"); } },
    });
    const revocable = Proxy.revocable({
      code: "support_report_already_completed",
      message: "completed",
      status: 400,
    }, {});
    revocable.revoke();

    for (const hostile of [trapped, revocable.proxy]) {
      expect(() => describeSupportReportUploadFailure(hostile, 1)).not.toThrow();
      expect(describeSupportReportUploadFailure(hostile, 1)).toMatchObject({
        kind: "transient",
        message: "Report upload failed.",
        retryable: true,
      });
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
