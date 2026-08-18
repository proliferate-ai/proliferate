import { formatMarkdownFileLink } from "#product/lib/domain/chat/composer/file-mention-links";

/**
 * The identity a context-doc mention carries: which run's doc registry the doc
 * belongs to, and the doc's on-disk filename inside the run workspace's context
 * directory. Both halves ride in the serialized token so the mention stays
 * resolvable after the on-disk layout becomes run-scoped.
 */
export interface ContextDocMentionRef {
  runId: string;
  filename: string;
}

/**
 * One row the mention menu can offer from the workspace's workflow runs' doc
 * registries. `runLabel` is the run's definition title when the frozen
 * invocation JSON carries one; the menu owns the fallback copy.
 */
export interface ContextDocMentionCandidate {
  docId: string;
  runId: string;
  slug: string;
  filename: string;
  runLabel: string | null;
}

/**
 * The serialized form of a context-doc mention is a markdown-link-shaped token
 * whose destination wears this prefix: `[label](@doc:<runId>/<filename>)`.
 *
 * The prefix is what keeps the two mention serializations disjoint in both
 * directions. A file mention's destination can never contain a colon (the file
 * transformer's body excludes `:` to reject URL schemes), so a file link can
 * never parse as a context-doc token; and this token's destination must open
 * with the literal prefix, so no workspace path or web URL can parse as one.
 */
export const CONTEXT_DOC_DESTINATION_PREFIX = "@doc:";

/**
 * Matches `[label](@doc:<destination>)`. Shared by the Lexical transformer
 * (chip round-trip while editing) and the send-time resolver below.
 */
export const CONTEXT_DOC_MENTION_LINK_BODY =
  "\\[([^\\[\\]]+)\\]\\(@doc:([^()\\s]+)\\)";

/**
 * One path segment: no separators, no traversal, no whitespace, parens, or
 * control characters. Square brackets are also out: the token's label
 * pattern cannot represent them (the same limitation the file-link body
 * carries), so a bracket-bearing segment would serialize to a token that
 * never re-parses.
 */
function isValidSegment(value: string): boolean {
  return (
    value.length > 0
    && value !== "."
    && value !== ".."
    && !/[/\\\s()[\]\u0000-\u001f\u007f]/u.test(value)
  );
}

export function isValidContextDocMentionRef(ref: ContextDocMentionRef): boolean {
  return isValidSegment(ref.runId) && isValidSegment(ref.filename);
}

/** Serializes a mention to its draft token, `[label](@doc:<runId>/<filename>)`. */
export function formatContextDocMentionToken(
  label: string,
  ref: ContextDocMentionRef,
): string {
  if (!isValidContextDocMentionRef(ref)) {
    return escapeMarkdownLabel(label || ref.filename);
  }
  const escapedLabel = escapeMarkdownLabel(label || ref.filename);
  return `[${escapedLabel}](${CONTEXT_DOC_DESTINATION_PREFIX}${ref.runId}/${ref.filename})`;
}

/** Parses a token destination (`@doc:<runId>/<filename>`) back to its ref. */
export function parseContextDocMentionDestination(
  destination: string,
): ContextDocMentionRef | null {
  if (!destination.startsWith(CONTEXT_DOC_DESTINATION_PREFIX)) {
    return null;
  }
  const body = destination.slice(CONTEXT_DOC_DESTINATION_PREFIX.length);
  const separator = body.indexOf("/");
  if (separator === -1) {
    return null;
  }
  const ref: ContextDocMentionRef = {
    runId: body.slice(0, separator),
    filename: body.slice(separator + 1),
  };
  return isValidContextDocMentionRef(ref) ? ref : null;
}

/**
 * Where the mentioned doc lives on disk, workspace-relative.
 *
 * This is the single resolution seam for chat-side context-doc mentions. Today
 * the runtime materializes every run's docs into the flat
 * `.proliferate/context/` directory; when the run-scoped layout
 * (`.proliferate/context/<runId>/`) ships, this function — and only this
 * function — folds `ref.runId` into the path. The token already carries the
 * run id for exactly that reason.
 */
export function contextDocMentionWorkspacePath(ref: ContextDocMentionRef): string {
  return `.proliferate/context/${ref.filename}`;
}

const CONTEXT_DOC_TOKEN_PATTERN = new RegExp(CONTEXT_DOC_MENTION_LINK_BODY, "g");

/**
 * Send-time resolution: rewrites every context-doc token in an outgoing prompt
 * to an ordinary workspace-relative markdown file link, the same pointer shape
 * a file mention sends. The agent dereferences the path with its own read
 * tools; nothing is inlined. Tokens whose destination does not parse are left
 * untouched — they are prose, not mentions.
 */
export function resolveContextDocMentionTokens(text: string): string {
  return text.replace(CONTEXT_DOC_TOKEN_PATTERN, (token, label: string, destination: string) => {
    const ref = parseContextDocMentionDestination(
      `${CONTEXT_DOC_DESTINATION_PREFIX}${destination}`,
    );
    if (!ref) {
      return token;
    }
    return formatMarkdownFileLink(
      unescapeMarkdown(label),
      contextDocMentionWorkspacePath(ref),
    );
  });
}

/**
 * Filters the doc-registry candidates against the typed mention query.
 *
 * Candidates arrive newest-run-first from the source hook and stay in that
 * order; the query narrows rather than re-ranks, because the set is small and
 * bounded (unlike file search, which ranks a 200-row fuzzy page).
 */
export function filterContextDocMentionCandidates(
  candidates: readonly ContextDocMentionCandidate[],
  query: string,
): ContextDocMentionCandidate[] {
  const needle = query.trim().toLowerCase();
  const seen = new Set<string>();
  const filtered: ContextDocMentionCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.docId)) {
      continue;
    }
    if (!isValidContextDocMentionRef(candidate)) {
      continue;
    }
    if (needle.length > 0 && !candidateMatches(candidate, needle)) {
      continue;
    }
    seen.add(candidate.docId);
    filtered.push(candidate);
  }
  return filtered;
}

function candidateMatches(candidate: ContextDocMentionCandidate, needle: string): boolean {
  return (
    candidate.filename.toLowerCase().includes(needle)
    || candidate.slug.toLowerCase().includes(needle)
    || (candidate.runLabel?.toLowerCase().includes(needle) ?? false)
  );
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\\[\]])/g, "\\$1");
}

function unescapeMarkdown(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}
