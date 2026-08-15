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

const PROMPT_TITLE_MAX_CHARS = 160;

/**
 * Prompt text normalized into a session title: whitespace collapsed and capped
 * at the runtime's title limit. The runtime persists the same fallback when it
 * accepts the first prompt of an untitled session; a generated summary or user
 * rename replaces it later.
 */
export function promptFallbackTitle(text: string | null | undefined): string | null {
  const collapsed = (text ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return null;
  }
  // Truncate by code points to match the runtime's chars()-based cap, so the
  // optimistic and persisted titles agree and no surrogate pair is split.
  return Array.from(collapsed).slice(0, PROMPT_TITLE_MAX_CHARS).join("").trimEnd();
}
