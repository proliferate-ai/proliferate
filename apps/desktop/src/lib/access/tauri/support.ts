import { invoke } from "@tauri-apps/api/core";
import type {
  BeginSupportSnapshotInput,
  FinishSupportSnapshotInput,
  FinishSupportSnapshotSubmissionInputV1,
  PersistedSupportArtifactRefV1,
  PreparedSupportSnapshotV1,
  ReconciledSupportArtifactV1,
  SupportSnapshotPreparation,
} from "@proliferate/product-client/host/desktop-bridge";
import { isTauriDesktop } from "@/lib/access/tauri/diagnostics";

export async function stageSupportReportAttachment(input: {
  clientFileId: string;
  fileName: string;
  dataBase64: string;
}): Promise<string | null> {
  if (!isTauriDesktop()) {
    return null;
  }

  const result = await invoke<{ path: string }>("stage_support_report_attachment", {
    input,
  });
  return result.path;
}

export async function readStagedSupportReportAttachment(path: string): Promise<string> {
  if (!isTauriDesktop()) {
    throw new Error("Staged attachments are only available in the desktop app.");
  }

  const result = await invoke<{ dataBase64: string }>(
    "read_staged_support_report_attachment",
    { input: { path } },
  );
  return result.dataBase64;
}

export async function deleteStagedSupportReportAttachment(path: string): Promise<void> {
  if (!isTauriDesktop()) {
    return;
  }

  await invoke("delete_staged_support_report_attachment", { input: { path } });
}

// --- Consented support snapshot ----------------------------------------------
//
// The nine main-window support-snapshot commands. Each wrapper passes the exact
// camelCase bridge input through the `{ input }` invoke envelope and returns
// only the opaque handles/metadata the bridge contract declares — never a
// physical path, collector connection material, or support permit. Outside a
// working native host the boundary stays closed: preparation, artifact reads,
// reconciliation, and submission fail; cancellation and deletion are idempotent
// no-ops; archive saving reports no archive, matching the existing adapter
// nullability patterns.

const supportSnapshotUnavailable = () =>
  new Error("Support snapshots are only available in the desktop app.");

export async function beginSupportSnapshotPreparation(
  input: BeginSupportSnapshotInput,
): Promise<SupportSnapshotPreparation> {
  if (!isTauriDesktop()) {
    throw supportSnapshotUnavailable();
  }

  return invoke<SupportSnapshotPreparation>(
    "begin_support_snapshot_preparation",
    { input },
  );
}

export async function finishSupportSnapshotPreparation(
  input: FinishSupportSnapshotInput,
): Promise<PreparedSupportSnapshotV1> {
  if (!isTauriDesktop()) {
    throw supportSnapshotUnavailable();
  }

  return invoke<PreparedSupportSnapshotV1>(
    "finish_support_snapshot_preparation",
    { input },
  );
}

export async function cancelSupportSnapshotPreparation(input: {
  clientJobId: string;
  consentEpoch: string;
  preparationId?: string;
}): Promise<void> {
  if (!isTauriDesktop()) {
    return;
  }

  await invoke("cancel_support_snapshot_preparation", { input });
}

export async function saveSupportSnapshotArchive(input: {
  artifactId: string;
  consentEpoch: string;
}): Promise<string | null> {
  if (!isTauriDesktop()) {
    return null;
  }

  const result = await invoke<{ archivePath: string } | null>(
    "save_support_snapshot_archive",
    { input },
  );
  return result?.archivePath ?? null;
}

export async function readStagedSupportSnapshot(input: {
  artifactId: string;
  expectedSizeBytes: number;
  expectedSha256: string;
}): Promise<string> {
  if (!isTauriDesktop()) {
    throw supportSnapshotUnavailable();
  }

  const result = await invoke<{ dataBase64: string }>(
    "read_staged_support_snapshot",
    { input },
  );
  return result.dataBase64;
}

export async function deleteStagedSupportSnapshot(artifactId: string): Promise<void> {
  if (!isTauriDesktop()) {
    return;
  }

  await invoke("delete_staged_support_snapshot", { input: { artifactId } });
}

export async function reconcileStagedSupportSnapshots(input: {
  artifacts: PersistedSupportArtifactRefV1[];
  referencedAttachmentPaths: string[];
}): Promise<ReconciledSupportArtifactV1[]> {
  if (!isTauriDesktop()) {
    throw supportSnapshotUnavailable();
  }

  return invoke<ReconciledSupportArtifactV1[]>(
    "reconcile_staged_support_snapshots",
    { input },
  );
}

export async function beginSupportSnapshotSubmission(input: {
  artifactId: string;
  clientJobId: string;
  attempt: number;
  parentOperationId: string;
}): Promise<{ submissionId: string; operationId: string }> {
  if (!isTauriDesktop()) {
    throw supportSnapshotUnavailable();
  }

  return invoke<{ submissionId: string; operationId: string }>(
    "begin_support_snapshot_submission",
    { input },
  );
}

export async function finishSupportSnapshotSubmission(
  input: FinishSupportSnapshotSubmissionInputV1,
): Promise<void> {
  if (!isTauriDesktop()) {
    throw supportSnapshotUnavailable();
  }

  await invoke("finish_support_snapshot_submission", { input });
}
