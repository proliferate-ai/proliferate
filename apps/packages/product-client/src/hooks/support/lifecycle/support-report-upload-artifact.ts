import type {
  DesktopSupportSnapshotBridge,
  PreparedSupportSnapshotV1,
} from "@proliferate/product-client/host/desktop-bridge";
import {
  snapshotSupportReportUploadError,
  SupportSnapshotArtifactError,
} from "#product/lib/domain/support/report-upload-failure";

import { DIAGNOSTICS_MAX_BYTES, sha256Hex } from "./support-report-upload-payload";

export interface VerifiedSupportSnapshotUpload {
  artifact: PreparedSupportSnapshotV1;
  blob: Blob;
  sha256: string;
}

/** Read and verify one exact staged artifact before any server-side effect. */
export async function readVerifiedSupportSnapshot(
  bridge: DesktopSupportSnapshotBridge,
  artifact: PreparedSupportSnapshotV1,
): Promise<VerifiedSupportSnapshotUpload> {
  let encoded: string;
  try {
    encoded = await bridge.readArtifact({
      artifactId: artifact.artifactId,
      expectedSizeBytes: artifact.sizeBytes,
      expectedSha256: artifact.sha256,
    });
  } catch (error) {
    throw new SupportSnapshotArtifactError(classifyNativeArtifactRead(error));
  }
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64Bounded(encoded, DIAGNOSTICS_MAX_BYTES);
  } catch {
    throw new SupportSnapshotArtifactError("snapshot_mismatch");
  }
  if (bytes.byteLength !== artifact.sizeBytes || bytes.byteLength > DIAGNOSTICS_MAX_BYTES) {
    throw new SupportSnapshotArtifactError("snapshot_mismatch");
  }
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/json" });
  const sha256 = await sha256Hex(await blob.arrayBuffer());
  if (sha256 !== artifact.sha256) {
    throw new SupportSnapshotArtifactError("snapshot_mismatch");
  }
  return { artifact, blob, sha256 };
}

function decodeBase64Bounded(value: string, maximumBytes: number): Uint8Array {
  if (typeof value !== "string" || value.length === 0
    || value.length > 4 * Math.ceil(maximumBytes / 3) + 4
    || value.length % 4 === 1
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("invalid base64");
  }
  const decoded = atob(value);
  if (decoded.length > maximumBytes) throw new Error("base64 cap");
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

function classifyNativeArtifactRead(
  error: unknown,
): "snapshot_mismatch" | "snapshot_missing" {
  const code = typeof error === "string"
    ? error
    : snapshotSupportReportUploadError(error).code;
  return code === "support_snapshot_artifact_missing"
    ? "snapshot_missing"
    : "snapshot_mismatch";
}
