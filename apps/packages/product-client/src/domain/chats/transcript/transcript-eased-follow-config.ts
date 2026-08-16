/**
 * Flag discipline for the eased-follow motion writer (PRO-168, design question
 * Q16, rung 12). Follows the same localStorage-flag convention as
 * transcript-virtualization-config.ts: an explicit opt-in string, read once at
 * mount, defaulting OFF so v1's instant glue stays byte-identical unless a
 * reader deliberately turns the prototype on.
 */
export const TRANSCRIPT_EASED_FOLLOW_STORAGE_KEY = "proliferate:transcriptEasedFollow";

export function resolveTranscriptEasedFollowEnabled(value: string | null): boolean {
  return value === "on";
}

/** Read the flag once at mount (same convention as the virtualization-mode flag). */
export function readTranscriptEasedFollowEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return resolveTranscriptEasedFollowEnabled(
    window.localStorage.getItem(TRANSCRIPT_EASED_FOLLOW_STORAGE_KEY),
  );
}
