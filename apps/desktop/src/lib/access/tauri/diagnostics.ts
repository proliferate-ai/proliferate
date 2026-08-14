import { invoke } from "@tauri-apps/api/core";
import type {
  IngestBatchV1,
  IngestReceiptV1,
} from "@proliferate/product-client/internal/domain/diagnostics/contract";
import {
  parseIngestBatchV1,
  parseIngestReceiptV1,
} from "@proliferate/product-client/internal/domain/diagnostics/validation";

export function isTauriDesktop(): boolean {
  return typeof window !== "undefined"
    && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

export interface SupportDiagnosticsLog {
  source: string;
  path: string;
  bytesRead: number;
  truncated: boolean;
  text: string;
}

export interface SupportDiagnosticsBundle {
  schemaVersion: number;
  manifest: {
    appVersion: string;
    runtimeVersion?: string | null;
    runtimeStatus?: string | null;
    runtimeHome?: string | null;
    platform: string;
    timestamp: string;
  };
  health?: {
    runtimeHome: string;
    status: string;
    version: string;
  } | null;
  logs: SupportDiagnosticsLog[];
  collectionErrors: string[];
}

export async function ingestRendererDiagnosticsBatch(
  input: IngestBatchV1,
): Promise<IngestReceiptV1> {
  let batch: IngestBatchV1;
  try {
    batch = parseIngestBatchV1(input);
  } catch {
    throw new Error("renderer_ingest_invalid_batch");
  }
  if (
    batch.schema_version.major !== 1
    || batch.schema_version.minor !== 1
    || batch.records.length === 0
    || batch.records.some((record) =>
      record.schema_version.major !== 1
      || record.schema_version.minor !== 1
      || record.component !== "desktop_renderer"
      || record.source !== "renderer"
    )
  ) {
    throw new Error("renderer_ingest_invalid_batch");
  }
  if (!isTauriDesktop()) {
    throw new Error("renderer_ingest_collector_unsupported");
  }

  const rawReceipt = await invoke("ingest_renderer_diagnostics", { batch });
  try {
    const receipt = parseIngestReceiptV1(rawReceipt);
    assertCoherentRendererReceipt(receipt, batch.records.length);
    return receipt;
  } catch {
    throw new Error("renderer_ingest_protocol_error");
  }
}

function assertCoherentRendererReceipt(
  receipt: IngestReceiptV1,
  submittedCount: number,
): void {
  const { accepted_count: acceptedCount, accepted_range: acceptedRange } = receipt;
  if (
    receipt.schema_version.major !== 1
    || receipt.schema_version.minor !== 1
    || acceptedCount + receipt.duplicate_count + receipt.rejections.length
      !== submittedCount
  ) {
    throw new Error("renderer_ingest_protocol_error");
  }

  const rejectionIndexes = new Set<number>();
  for (const rejection of receipt.rejections) {
    if (
      rejection.index >= submittedCount
      || rejectionIndexes.has(rejection.index)
    ) {
      throw new Error("renderer_ingest_protocol_error");
    }
    rejectionIndexes.add(rejection.index);
  }

  if (acceptedCount === 0) {
    if (acceptedRange !== undefined) {
      throw new Error("renderer_ingest_protocol_error");
    }
    return;
  }
  if (
    acceptedRange === undefined
    || acceptedRange.first > acceptedRange.last
    || acceptedRange.last - acceptedRange.first + 1 !== acceptedCount
  ) {
    throw new Error("renderer_ingest_protocol_error");
  }
}

export async function exportDebugBundle(): Promise<string | null> {
  if (!isTauriDesktop()) {
    return null;
  }

  const result = await invoke<{ outputPath: string } | null>("export_debug_bundle");
  return result?.outputPath ?? null;
}

export async function collectSupportDiagnostics(): Promise<SupportDiagnosticsBundle | null> {
  if (!isTauriDesktop()) {
    return null;
  }

  return invoke<SupportDiagnosticsBundle>("collect_support_diagnostics");
}

export async function saveDiagnosticJson(
  suggestedFileName: string,
  contents: string,
): Promise<string | null> {
  if (!isTauriDesktop()) {
    return null;
  }

  const result = await invoke<{ outputPath: string } | null>(
    "save_diagnostic_json",
    { suggestedFileName, contents },
  );
  return result?.outputPath ?? null;
}

export async function saveDiagnosticJsonToPath(
  outputPath: string,
  contents: string,
): Promise<string | null> {
  if (!isTauriDesktop()) {
    return null;
  }

  const result = await invoke<{ outputPath: string }>(
    "save_diagnostic_json_to_absolute_path",
    {
      input: {
        outputPath,
        contents,
      },
    },
  );
  return result.outputPath;
}
