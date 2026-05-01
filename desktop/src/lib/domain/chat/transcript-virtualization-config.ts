export const TRANSCRIPT_VIRTUALIZATION_STORAGE_KEY =
  "proliferate:transcriptVirtualization";

export const TRANSCRIPT_VIRTUALIZATION_AUTO_ROW_THRESHOLD = 80;

export type TranscriptVirtualizationMode = "auto" | "on" | "off";

export function parseTranscriptVirtualizationMode(
  value: string | null,
): TranscriptVirtualizationMode {
  if (value === "on" || value === "off" || value === "auto") {
    return value;
  }
  return "auto";
}

export function resolveTranscriptVirtualizationEnabled(input: {
  mode: TranscriptVirtualizationMode;
  rowCount: number;
  autoRowThreshold?: number;
}): boolean {
  if (input.mode === "on") {
    return true;
  }
  if (input.mode === "off") {
    return false;
  }
  return input.rowCount >= (
    input.autoRowThreshold ?? TRANSCRIPT_VIRTUALIZATION_AUTO_ROW_THRESHOLD
  );
}
