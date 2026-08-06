export const TRANSCRIPT_VIRTUALIZATION_STORAGE_KEY =
  "proliferate:transcriptVirtualization";

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
}): boolean {
  // Mount the normal path once and keep it stable as a live transcript grows.
  // Threshold switching either strands new chats on the full-DOM renderer or
  // remounts the viewport at the threshold, both of which defeat smooth scroll.
  // `off` remains an explicit diagnostic escape hatch.
  return input.mode !== "off";
}
