/**
 * The excerpt test, as code.
 *
 * A toast may render payload lines inline only when they are a *countable
 * list* — field errors, file paths, secret names. Free-form prose and stack
 * traces are one opaque blob: the toast shows the first sentence and the rest
 * lives behind Details. This module is the single place that decides which of
 * the two a payload is, so no caller gets to eyeball it.
 */

/** Inline excerpts never exceed three lines; a fourth becomes "+N more". */
export const TOAST_EXCERPT_MAX_LINES = 3;

/** A countable item is an identifier-ish line, not a sentence. */
const COUNTABLE_LINE_MAX_CHARS = 120;

const STACK_FRAME_RE = /^\s*(?:at\s+\S|[A-Za-z]*Error:)/;
const JSON_BLOB_RE = /^\s*[{[]/;
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;

function isStackFrameLine(line: string): boolean {
  return STACK_FRAME_RE.test(line);
}

function isJsonBlobLine(line: string): boolean {
  return JSON_BLOB_RE.test(line);
}

/**
 * Prose gives itself away by sentence shape: many words, and a full stop that
 * is followed by more text or ends a long clause. A field error like
 * `steps[2].timeout must be ≤ 3600` is long-ish but has no sentence end.
 */
function looksLikeProse(line: string): boolean {
  const words = line.trim().split(/\s+/);
  if (words.length <= 8) {
    return false;
  }
  return /[.!?]\s/.test(line) || /[.!?]$/.test(line.trim());
}

export interface ToastPayloadReading {
  /** Lines safe to render inline; empty when the payload is a blob. */
  lines: string[];
  /** How many countable lines were dropped past the 3-line cap. */
  overflow: number;
  /** True when the payload failed the excerpt test and must stay behind Details. */
  blob: boolean;
  /** The one legible fact for a blob payload: its first sentence. */
  firstSentence: string;
}

/**
 * Read a raw payload and decide what, if anything, may be shown inline.
 *
 * Returns `blob: true` for anything that is prose, a stack, or JSON — in that
 * case `lines` is empty by construction, so a caller physically cannot render
 * a stack trace inside a toast.
 */
export function readToastPayload(payload: string): ToastPayloadReading {
  const trimmed = payload.trim();
  // Bounded by the first line as well as the first full stop: a stack trace's
  // header has no terminating punctuation, so splitting on sentences alone
  // would hand the caller the frames it is supposed to be hiding.
  const firstLine = trimmed.split("\n")[0]?.trim() ?? "";
  const firstSentence = firstLine.split(SENTENCE_SPLIT_RE)[0]?.trim() ?? "";
  if (trimmed.length === 0) {
    return { lines: [], overflow: 0, blob: false, firstSentence: "" };
  }

  const rawLines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const countable =
    rawLines.length > 0
    && rawLines.every(
      (line) =>
        line.length <= COUNTABLE_LINE_MAX_CHARS
        && !isStackFrameLine(line)
        && !isJsonBlobLine(line)
        && !looksLikeProse(line),
    );

  if (!countable) {
    return { lines: [], overflow: 0, blob: true, firstSentence };
  }

  return {
    lines: rawLines.slice(0, TOAST_EXCERPT_MAX_LINES),
    overflow: Math.max(0, rawLines.length - TOAST_EXCERPT_MAX_LINES),
    blob: false,
    firstSentence,
  };
}

/** `+2 more` label for the lines the 3-line cap dropped, or null when none. */
export function toastOverflowLabel(overflow: number): string | null {
  return overflow > 0 ? `+${overflow} more` : null;
}
