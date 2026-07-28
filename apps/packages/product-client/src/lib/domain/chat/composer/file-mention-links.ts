export interface SerializedFileLinkToken {
  type: "file_link";
  raw: string;
  label: string;
  path: string;
}

export interface TextToken {
  type: "text";
  text: string;
}

export type UserMessageToken = TextToken | SerializedFileLinkToken;

export function isValidWorkspaceRelativePath(path: string): boolean {
  return normalizeWorkspaceRelativePath(path) !== null;
}

export function normalizeWorkspaceRelativePath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) return null;
  if (/[\u0000-\u001f\u007f]/u.test(trimmed)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  if (trimmed.startsWith("/") || trimmed.startsWith("~/") || trimmed === "~") return null;
  if (trimmed.startsWith("#") || trimmed.includes("\\") || trimmed.includes("#")) return null;

  const withoutDotSlash = trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
  if (!withoutDotSlash || withoutDotSlash === "." || withoutDotSlash === "..") return null;
  const segments = withoutDotSlash.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }
  return withoutDotSlash;
}

export function workspaceFileBasename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

/**
 * Directory portion of a workspace path, as much of it as a composer chip can
 * carry.
 *
 * A mention chip has to read as a file *reference*, which means the path has to
 * be on it — but the composer is a narrow, single-line-ish surface, so a deep
 * path cannot be allowed to dominate the chip and push the basename (the thing
 * the user actually typed) out of the reading order. So the directory is elided
 * rather than wrapped or scrolled, and the elision happens HERE rather than via
 * CSS `text-overflow` for one reason: `text-overflow` drops the tail, and the
 * tail of a directory chain is its most identifying part. `…/src/components`
 * tells you where the file lives; `apps/packages/produc…` does not. The full
 * path always remains on the chip as its tooltip and its link target, so this is
 * purely how much of it is painted.
 */
const MENTION_DIRECTORY_LABEL_BUDGET = 32;

export function composerFileMentionDirectoryLabel(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean).slice(0, -1);
  if (segments.length === 0) {
    // A file at the workspace root has no directory to show; the chip then
    // carries the basename alone, which is already the whole path.
    return "";
  }

  const kept: string[] = [];
  let width = 0;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!;
    // +1 for the "/" that will join this segment to the ones after it.
    const next = width + segment.length + (kept.length > 0 ? 1 : 0);
    if (kept.length > 0 && next > MENTION_DIRECTORY_LABEL_BUDGET) {
      return `…/${kept.join("/")}`;
    }
    kept.unshift(segment);
    width = next;
  }

  if (width > MENTION_DIRECTORY_LABEL_BUDGET) {
    // A single directory name longer than the whole budget: keep its tail, which
    // is the part that distinguishes sibling directories from each other.
    return `…${kept.join("/").slice(-MENTION_DIRECTORY_LABEL_BUDGET)}`;
  }
  return kept.join("/");
}

export function formatMarkdownFileLink(label: string, rawPath: string): string {
  const path = normalizeWorkspaceRelativePath(rawPath);
  if (!path) {
    return escapeMarkdownText(label || rawPath);
  }

  const escapedLabel = escapeMarkdownLabel(label || workspaceFileBasename(path));
  const escapedPath = escapeMarkdownDestination(path);
  return `[${escapedLabel}](${escapedPath})`;
}

export function tokenizeSerializedFileLinks(content: string): UserMessageToken[] {
  const tokens: UserMessageToken[] = [];
  let cursor = 0;
  let textBuffer = "";

  function flushText() {
    if (textBuffer.length > 0) {
      tokens.push({ type: "text", text: textBuffer });
      textBuffer = "";
    }
  }

  while (cursor < content.length) {
    if (content[cursor] !== "[") {
      textBuffer += content[cursor];
      cursor += 1;
      continue;
    }

    const parsed = parseMarkdownFileLinkAt(content, cursor);
    if (!parsed) {
      textBuffer += content[cursor];
      cursor += 1;
      continue;
    }

    flushText();
    tokens.push(parsed.token);
    cursor = parsed.end;
  }

  flushText();
  return tokens;
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\[\]])/g, "\\$1");
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\\[\]])/g, "\\$1");
}

function escapeMarkdownDestination(path: string): string {
  const escaped = path.replace(/([\\<>])/g, "\\$1");
  return /[\s()]/u.test(escaped) ? `<${escaped}>` : escaped.replace(/([()])/g, "\\$1");
}

function parseMarkdownFileLinkAt(
  content: string,
  start: number,
): { token: SerializedFileLinkToken; end: number } | null {
  const label = readUntilUnescaped(content, start + 1, "]");
  if (!label || content[label.end + 1] !== "(") {
    return null;
  }

  const destinationStart = label.end + 2;
  const destination = content[destinationStart] === "<"
    ? readUntilUnescaped(content, destinationStart + 1, ">")
    : readUntilUnescaped(content, destinationStart, ")");
  if (!destination) {
    return null;
  }

  const closeParenIndex = content[destination.end + (content[destinationStart] === "<" ? 1 : 0)];
  const end = content[destinationStart] === "<" ? destination.end + 2 : destination.end + 1;
  if (closeParenIndex !== ")") {
    return null;
  }

  const path = normalizeWorkspaceRelativePath(unescapeMarkdown(destination.value));
  if (!path) {
    return null;
  }

  return {
    end,
    token: {
      type: "file_link",
      raw: content.slice(start, end),
      label: unescapeMarkdown(label.value),
      path,
    },
  };
}

function readUntilUnescaped(
  content: string,
  start: number,
  delimiter: string,
): { value: string; end: number } | null {
  let value = "";
  let escaped = false;

  for (let index = start; index < content.length; index += 1) {
    const char = content[index]!;
    if (escaped) {
      value += `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === delimiter) {
      return { value, end: index };
    }
    value += char;
  }

  return null;
}

function unescapeMarkdown(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}
