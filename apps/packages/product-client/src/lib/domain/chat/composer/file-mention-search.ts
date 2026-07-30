import {
  normalizeWorkspaceRelativePath,
  workspaceFileBasename,
} from "#product/lib/domain/chat/composer/file-mention-links";

export interface FileMentionTrigger {
  /** Offset of the "@" that opened the menu. */
  start: number;
  /** Offset just past the mention token (before whitespace or end). */
  end: number;
  /** Text typed after the "@", used as the file search query. */
  query: string;
}

export interface FileMentionCandidate {
  path: string;
  name: string;
}

export interface FileMentionResult {
  /** Workspace-relative path, normalized. */
  path: string;
  /** Basename used as the inserted link label. */
  name: string;
  /** Directory portion, shown as the muted secondary detail. */
  parent: string;
}

/**
 * Longest mention query we will search on. Beyond this the token is almost
 * certainly prose (an email, a handle) rather than a file lookup.
 */
const MAX_MENTION_QUERY_LENGTH = 120;

/**
 * Finds an active `@` file-mention token around the caret.
 *
 * Unlike slash commands, mentions are legal anywhere in the prompt — but the
 * "@" must open a token (start of draft or after whitespace), so `user@host`
 * and email addresses never open the menu. The composer is also where shell
 * snippets and pasted code land, so an "@" that is inside a fenced or inline
 * markdown code span (a decorator, an npm scope reference, a shell arg) is
 * prompt content, not a mention request, and must not open the menu either.
 */
export function findFileMentionTrigger(
  text: string,
  selectionOffset: number,
): FileMentionTrigger | null {
  if (selectionOffset < 0 || selectionOffset > text.length) {
    return null;
  }

  const tokenStart = findTokenStart(text, selectionOffset);
  if (text[tokenStart] !== "@") {
    return null;
  }

  if (isInsideMarkdownCode(text, tokenStart)) {
    return null;
  }

  const query = text.slice(tokenStart + 1, selectionOffset);
  if (query.length > MAX_MENTION_QUERY_LENGTH) {
    return null;
  }

  return {
    start: tokenStart,
    end: findTokenEnd(text, selectionOffset),
    query,
  };
}

/**
 * True when `position` falls inside an unclosed fenced (```) or inline (`)
 * markdown code span. Scans from the start of the draft rather than trying to
 * pair backticks locally, since a single-character delimiter can't be told
 * apart from its own closer without tracking every prior toggle.
 */
function isInsideMarkdownCode(text: string, position: number): boolean {
  let inFence = false;
  let inSpan = false;
  let offset = 0;
  while (offset < position) {
    if (!inSpan && text.startsWith("```", offset)) {
      inFence = !inFence;
      offset += 3;
      continue;
    }
    if (!inFence && text[offset] === "`") {
      inSpan = !inSpan;
      offset += 1;
      continue;
    }
    offset += 1;
  }
  return inFence || inSpan;
}

/**
 * Turns raw workspace file-search hits into mention rows.
 *
 * Search results arrive path-ordered from the runtime; the composer wants
 * basename-first relevance because the user is typing a file name, not a path.
 * Paths the mention format cannot represent (absolute, escaped, out-of-tree)
 * are dropped rather than inserted as a broken link.
 */
export function rankFileMentionResults(
  candidates: readonly FileMentionCandidate[],
  query: string,
  limit: number,
): FileMentionResult[] {
  const needle = query.trim().toLowerCase();
  const seen = new Set<string>();
  const ranked: Array<{ rank: number; result: FileMentionResult }> = [];

  for (const candidate of candidates) {
    const path = normalizeWorkspaceRelativePath(candidate.path);
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);

    const name = candidate.name || workspaceFileBasename(path);
    const rank = matchRank(name.toLowerCase(), path.toLowerCase(), needle);
    if (rank === null) {
      continue;
    }
    ranked.push({
      rank,
      result: { path, name, parent: parentPath(path) },
    });
  }

  return ranked
    .map((entry, index) => ({ ...entry, index }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.result);
}

function matchRank(name: string, path: string, needle: string): number | null {
  if (needle.length === 0) {
    return 3;
  }
  if (name.startsWith(needle)) {
    return 0;
  }
  if (name.includes(needle)) {
    return 1;
  }
  if (path.includes(needle)) {
    return 2;
  }
  return null;
}

function parentPath(path: string): string {
  const segments = path.split("/");
  return segments.slice(0, -1).join("/");
}

function findTokenStart(text: string, selectionOffset: number): number {
  let offset = selectionOffset;
  while (offset > 0 && !/\s/u.test(text[offset - 1] ?? "")) {
    offset -= 1;
  }
  return offset;
}

function findTokenEnd(text: string, selectionOffset: number): number {
  let offset = selectionOffset;
  while (offset < text.length && !/\s/u.test(text[offset] ?? "")) {
    offset += 1;
  }
  return offset;
}
