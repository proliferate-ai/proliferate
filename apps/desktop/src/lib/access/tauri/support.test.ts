import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BeginSupportSnapshotInput,
  FinishSupportSnapshotInput,
  FinishSupportSnapshotSubmissionInputV1,
  PersistedSupportArtifactRefV1,
  PreparedSupportSnapshotV1,
  ReconciledSupportArtifactV1,
  SupportSnapshotPreparation,
} from "@proliferate/product-client/host/desktop-bridge";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauriDesktop: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/access/tauri/diagnostics", () => ({
  isTauriDesktop: mocks.isTauriDesktop,
}));

import {
  beginSupportSnapshotPreparation,
  beginSupportSnapshotSubmission,
  cancelSupportSnapshotPreparation,
  deleteStagedSupportReportAttachment,
  deleteStagedSupportSnapshot,
  finishSupportSnapshotPreparation,
  finishSupportSnapshotSubmission,
  readStagedSupportReportAttachment,
  readStagedSupportSnapshot,
  reconcileStagedSupportSnapshots,
  saveSupportSnapshotArchive,
  stageSupportReportAttachment,
} from "@/lib/access/tauri/support";

const beginInput: BeginSupportSnapshotInput = {
  clientJobId: "4f7a2c9e-6f7d-4c8a-9a3e-2b1d5e8f0a11",
  reportOpenedAt: "2026-08-12T10:00:00.000Z",
  consentEpoch: "epoch-1",
  consent: {
    version: 1,
    disclosureVersion: "desktop_support_snapshot_customer_content_v1",
    grantedAt: "2026-08-12T10:00:05.000Z",
    selection: {
      kind: "active_session",
      workspace: {
        kind: "bundled_local",
        workspaceId: "ws-1",
        anyharnessWorkspaceId: "ah-ws-1",
      },
      uiSessionId: "ui-session-1",
      materializedSessionId: "materialized-1",
    },
  },
};

const preparation: SupportSnapshotPreparation = {
  preparationId: "prep-1",
  preparationOperationId: "op-prep-1",
  capturedAt: "2026-08-12T10:00:06.000Z",
  window: {
    sourceTimeFrom: "2026-08-12T09:45:06.000Z",
    sourceTimeTo: "2026-08-12T10:00:06.000Z",
  },
};

const finishInput: FinishSupportSnapshotInput = {
  preparationId: "prep-1",
  consentEpoch: "epoch-1",
  sessionEvidenceJson: '{"sessions":[]}',
  sessionCollection: {
    state: "included",
    workspaceId: "ws-1",
    anyharnessWorkspaceId: "ah-ws-1",
    selectedSessions: 1,
    sessionIncludedBytes: 128,
    eventIncludedBytes: 256,
    rawNotificationIncludedBytes: 64,
    limitUncertainEndpoints: 0,
  },
};

const prepared: PreparedSupportSnapshotV1 = {
  artifactSchemaVersion: 3,
  artifactId: "ssv1_abc",
  snapshotId: "snap-1",
  preparationOperationId: "op-prep-1",
  generatedAt: "2026-08-12T10:00:09.000Z",
  sizeBytes: 1024,
  sha256: "a".repeat(64),
  summary: {
    collectorRecords: 10,
    fallbackRecords: 2,
    sessions: 1,
    omissions: 3,
    truncations: 0,
  },
};

const artifactRef: PersistedSupportArtifactRefV1 = {
  clientJobId: beginInput.clientJobId,
  artifactId: "ssv1_abc",
  snapshotId: "snap-1",
  sizeBytes: 1024,
  sha256: "a".repeat(64),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isTauriDesktop.mockReturnValue(true);
});

describe("support snapshot preparation wrappers", () => {
  it("begins preparation through the exact command and { input } envelope", async () => {
    mocks.invoke.mockResolvedValue(preparation);

    await expect(beginSupportSnapshotPreparation(beginInput)).resolves.toEqual(
      preparation,
    );
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "begin_support_snapshot_preparation",
      { input: beginInput },
    );
  });

  it("finishes preparation and returns the prepared artifact metadata", async () => {
    mocks.invoke.mockResolvedValue(prepared);

    await expect(finishSupportSnapshotPreparation(finishInput)).resolves.toEqual(
      prepared,
    );
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "finish_support_snapshot_preparation",
      { input: finishInput },
    );
  });

  it("passes an omitted session ledger through unchanged", async () => {
    mocks.invoke.mockResolvedValue(prepared);
    const omitted: FinishSupportSnapshotInput = {
      preparationId: "prep-1",
      consentEpoch: "epoch-1",
      sessionEvidenceJson: null,
      sessionCollection: {
        state: "omitted",
        reason: "no_selected_bundled_local_workspace",
      },
    };

    await finishSupportSnapshotPreparation(omitted);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "finish_support_snapshot_preparation",
      { input: omitted },
    );
  });

  it("cancels preparation with the job/epoch binding and optional handle", async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await cancelSupportSnapshotPreparation({
      clientJobId: beginInput.clientJobId,
      consentEpoch: "epoch-1",
      preparationId: "prep-1",
    });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "cancel_support_snapshot_preparation",
      {
        input: {
          clientJobId: beginInput.clientJobId,
          consentEpoch: "epoch-1",
          preparationId: "prep-1",
        },
      },
    );
  });
});

describe("support snapshot artifact wrappers", () => {
  it("saves an archive and returns the display-safe basename receipt", async () => {
    mocks.invoke.mockResolvedValue({ archiveName: "support-snapshot-ssv1_abc.zip" });

    await expect(
      saveSupportSnapshotArchive({ artifactId: "ssv1_abc", consentEpoch: "epoch-1" }),
    ).resolves.toBe("support-snapshot-ssv1_abc.zip");
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "save_support_snapshot_archive",
      { input: { artifactId: "ssv1_abc", consentEpoch: "epoch-1" } },
    );
  });

  it("maps a cancelled archive dialog to null", async () => {
    mocks.invoke.mockResolvedValue(null);

    await expect(
      saveSupportSnapshotArchive({ artifactId: "ssv1_abc", consentEpoch: "epoch-1" }),
    ).resolves.toBeNull();
  });

  it.each([
    ["a legacy absolute-path payload", { archivePath: "/chosen/archive.zip" }],
    ["a slashed receipt", { archiveName: "/chosen/archive.zip" }],
    ["a relative slashed receipt", { archiveName: "chosen/archive.zip" }],
    ["a backslashed receipt", { archiveName: "chosen\\archive.zip" }],
    ["a NUL-bearing receipt", { archiveName: "archive\0.zip" }],
    ["an empty receipt", { archiveName: "" }],
    ["a non-string receipt", { archiveName: 7 }],
    ["a dot receipt", { archiveName: "." }],
    ["a dot-dot receipt", { archiveName: ".." }],
    ["an oversized receipt", { archiveName: `${"a".repeat(125)}.zip` }],
    ["an oversized multibyte receipt", { archiveName: "é".repeat(65) }],
  ])("rejects %s closed", async (_label, payload) => {
    mocks.invoke.mockResolvedValue(payload);

    await expect(
      saveSupportSnapshotArchive({ artifactId: "ssv1_abc", consentEpoch: "epoch-1" }),
    ).rejects.toThrow(
      "Native host returned an invalid support snapshot archive receipt.",
    );
  });

  it("accepts a receipt at exactly the 128 UTF-8 byte bound", async () => {
    const name = `${"a".repeat(124)}.zip`;
    mocks.invoke.mockResolvedValue({ archiveName: name });

    await expect(
      saveSupportSnapshotArchive({ artifactId: "ssv1_abc", consentEpoch: "epoch-1" }),
    ).resolves.toBe(name);
  });

  it("never surfaces the absolute chosen path across the bridge", async () => {
    mocks.invoke.mockResolvedValue({ archivePath: "/chosen/archive.zip" });

    const rejection = await saveSupportSnapshotArchive({
      artifactId: "ssv1_abc",
      consentEpoch: "epoch-1",
    }).then(
      (value) => {
        throw new Error(`resolved with ${String(value)}`);
      },
      (error: unknown) => error,
    );
    expect(String(rejection)).not.toContain("/chosen/archive.zip");
  });

  it("reads a staged artifact by opaque ID and returns base64 bytes", async () => {
    mocks.invoke.mockResolvedValue({ dataBase64: "aGVsbG8=" });
    const input = {
      artifactId: "ssv1_abc",
      expectedSizeBytes: 1024,
      expectedSha256: "a".repeat(64),
    };

    await expect(readStagedSupportSnapshot(input)).resolves.toBe("aGVsbG8=");
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "read_staged_support_snapshot",
      { input },
    );
  });

  it("deletes a staged artifact by opaque ID", async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await deleteStagedSupportSnapshot("ssv1_abc");
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "delete_staged_support_snapshot",
      { input: { artifactId: "ssv1_abc" } },
    );
  });

  it("reconciles persisted references and returns per-reference states", async () => {
    const reconciled: ReconciledSupportArtifactV1[] = [
      { ...artifactRef, state: "verified" },
    ];
    mocks.invoke.mockResolvedValue(reconciled);
    const input = {
      artifacts: [artifactRef],
      referencedAttachmentPaths: ["/staged/a.png"],
    };

    await expect(reconcileStagedSupportSnapshots(input)).resolves.toEqual(reconciled);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "reconcile_staged_support_snapshots",
      { input },
    );
  });
});

describe("support snapshot submission wrappers", () => {
  it("begins a submission attempt and returns the submission handles", async () => {
    mocks.invoke.mockResolvedValue({
      submissionId: "sub-1",
      operationId: "op-sub-1",
    });
    const input = {
      artifactId: "ssv1_abc",
      clientJobId: beginInput.clientJobId,
      attempt: 2,
      parentOperationId: "op-prep-1",
    };

    await expect(beginSupportSnapshotSubmission(input)).resolves.toEqual({
      submissionId: "sub-1",
      operationId: "op-sub-1",
    });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "begin_support_snapshot_submission",
      { input },
    );
  });

  it("finishes a submission with the discriminated outcome input", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    const input: FinishSupportSnapshotSubmissionInputV1 = {
      submissionId: "sub-1",
      outcome: "failed",
      errorClassification: "transient",
      reportId: null,
    };

    await finishSupportSnapshotSubmission(input);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "finish_support_snapshot_submission",
      { input },
    );
  });
});

describe("outside the native desktop host", () => {
  beforeEach(() => {
    mocks.isTauriDesktop.mockReturnValue(false);
  });

  it("fails closed for preparation, reads, reconciliation, and submission", async () => {
    await expect(beginSupportSnapshotPreparation(beginInput)).rejects.toThrow(
      "Support snapshots are only available in the desktop app.",
    );
    await expect(finishSupportSnapshotPreparation(finishInput)).rejects.toThrow(
      "Support snapshots are only available in the desktop app.",
    );
    await expect(
      readStagedSupportSnapshot({
        artifactId: "ssv1_abc",
        expectedSizeBytes: 1024,
        expectedSha256: "a".repeat(64),
      }),
    ).rejects.toThrow("Support snapshots are only available in the desktop app.");
    await expect(
      reconcileStagedSupportSnapshots({
        artifacts: [artifactRef],
        referencedAttachmentPaths: [],
      }),
    ).rejects.toThrow("Support snapshots are only available in the desktop app.");
    await expect(
      beginSupportSnapshotSubmission({
        artifactId: "ssv1_abc",
        clientJobId: beginInput.clientJobId,
        attempt: 1,
        parentOperationId: "op-prep-1",
      }),
    ).rejects.toThrow("Support snapshots are only available in the desktop app.");
    await expect(
      finishSupportSnapshotSubmission({
        submissionId: "sub-1",
        outcome: "succeeded",
        reportId: "report-1",
      }),
    ).rejects.toThrow("Support snapshots are only available in the desktop app.");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("keeps cancellation and deletion as idempotent no-ops", async () => {
    await expect(
      cancelSupportSnapshotPreparation({
        clientJobId: beginInput.clientJobId,
        consentEpoch: "epoch-1",
      }),
    ).resolves.toBeUndefined();
    await expect(deleteStagedSupportSnapshot("ssv1_abc")).resolves.toBeUndefined();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("reports no archive without invoking native code", async () => {
    await expect(
      saveSupportSnapshotArchive({ artifactId: "ssv1_abc", consentEpoch: "epoch-1" }),
    ).resolves.toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe("legacy staged attachment wrappers", () => {
  it("stages, reads, and deletes attachments through the { input } envelope", async () => {
    const attachment = { clientFileId: "c1", fileName: "a.png", dataBase64: "b64" };
    mocks.invoke.mockResolvedValueOnce({ path: "/staged/a.png" });
    await expect(stageSupportReportAttachment(attachment)).resolves.toBe(
      "/staged/a.png",
    );
    expect(mocks.invoke).toHaveBeenCalledWith("stage_support_report_attachment", {
      input: attachment,
    });

    mocks.invoke.mockResolvedValueOnce({ dataBase64: "b64" });
    await expect(readStagedSupportReportAttachment("/staged/a.png")).resolves.toBe(
      "b64",
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "read_staged_support_report_attachment",
      { input: { path: "/staged/a.png" } },
    );

    mocks.invoke.mockResolvedValueOnce(undefined);
    await deleteStagedSupportReportAttachment("/staged/a.png");
    expect(mocks.invoke).toHaveBeenCalledWith(
      "delete_staged_support_report_attachment",
      { input: { path: "/staged/a.png" } },
    );
  });

  it("preserves the existing host-unavailable behavior per method", async () => {
    mocks.isTauriDesktop.mockReturnValue(false);

    await expect(
      stageSupportReportAttachment({
        clientFileId: "c1",
        fileName: "a.png",
        dataBase64: "b64",
      }),
    ).resolves.toBeNull();
    await expect(readStagedSupportReportAttachment("/staged/a.png")).rejects.toThrow(
      "Staged attachments are only available in the desktop app.",
    );
    await expect(
      deleteStagedSupportReportAttachment("/staged/a.png"),
    ).resolves.toBeUndefined();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
