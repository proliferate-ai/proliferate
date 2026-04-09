import type { TranscriptState } from "@anyharness/sdk";

export function getEffectiveSessionTitle(input: {
  title?: string | null;
  transcript?: Pick<TranscriptState, "sessionMeta"> | null;
}): string | null {
  const explicitTitle = input.title?.trim();
  if (explicitTitle) {
    return explicitTitle;
  }

  const transcriptTitle = input.transcript?.sessionMeta.title?.trim();
  return transcriptTitle || null;
}
