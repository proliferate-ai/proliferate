import { buildMarkdownCodeMask } from "./markdown-code-context";

/**
 * Shared transcript scanner and render-copy repair for local-file Markdown
 * links.
 *
 * An assistant routinely writes `[notes](/repo/My Notes.md)`. CommonMark stops
 * the destination at the first space, so the parser hands the renderer a
 * truncated href and leaks the remainder as text. This module produces a pure
 * render copy in which such a destination is angle-wrapped and its literal
 * U+0020 spaces are written as `%20`, leaving the authoritative transcript
 * bytes untouched.
 *
 * Settled repair, streaming-tail stabilization, and the end-resource card all
 * consume the one scanner here so their link, code, image, escape, title, and
 * malformed-input decisions cannot drift apart.
 *
 * Everything exported is pure, and `repairTranscriptFileLinks` is idempotent:
 * a repaired destination is angle-wrapped, and wrapped destinations are never
 * rewritten again.
 */

/** One complete, well-formed inline link found outside code context. */
export interface TranscriptMarkdownLink {
  /** Index of `[` in the source. */
  start: number;
  /** Exclusive index just past the closing `)`. */
  end: number;
  isImage: boolean;
  /** Label source between the brackets, escapes preserved. */
  label: string;
  /** Destination source, escapes preserved, without any `<`/`>` wrapper. */
  destination: string;
  destinationWrapped: boolean;
  /** Complete title including its delimiters, or null. */
  title: string | null;
  /** True when the link token spans a line break. */
  multiline: boolean;
}

/**
 * Explicit local-path syntax. A single leading ASCII letter plus `:` plus one
 * slash is the sole colon-prefix exception: it is drive-root path syntax, not
 * an authority grant, so every URI scheme (including `file:`) stays excluded.
 */
const ELIGIBLE_LOCAL_PREFIX = /^(?:\/(?!\/)|~\/|\.\/|\.\.\/|[A-Za-z]:[\\/])/;
/** `?` and `#` are literal path characters in an explicit Markdown destination. */
const GLOB_METACHARACTER = /[*[\]{}]/;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;
/** Any whitespace other than U+0020, which is the one space we accept. */
const DISALLOWED_WHITESPACE = /[^\S ]/;

/** Does this unwrapped destination qualify for local-file repair? */
export function isEligibleLocalFileDestination(destination: string): boolean {
  if (!destination) return false;
  if (!ELIGIBLE_LOCAL_PREFIX.test(destination)) return false;
  if (destination.includes("<") || destination.includes(">")) return false;
  if (GLOB_METACHARACTER.test(destination)) return false;
  if (CONTROL_CHARACTER.test(destination)) return false;
  if (DISALLOWED_WHITESPACE.test(destination)) return false;
  return true;
}

/** Resolve the CommonMark backslash escapes a destination may carry. */
export function unescapeMarkdownDestination(value: string): string {
  return value.replace(/\\([\\()<>])/g, "$1");
}

/** Every complete, well-formed inline link outside code context, in source order. */
export function scanTranscriptMarkdownLinks(source: string): TranscriptMarkdownLink[] {
  const masked = buildMarkdownCodeMask(source);
  const links: TranscriptMarkdownLink[] = [];
  let index = 0;
  while (index < source.length) {
    if (masked[index] || source[index] !== "[" || isEscaped(source, index)) {
      index += 1;
      continue;
    }
    const link = readLink(source, masked, index);
    if (!link) {
      index += 1;
      continue;
    }
    links.push(link);
    index = link.end;
  }
  return links;
}

/**
 * Angle-wrap eligible local destinations and encode their literal spaces.
 * Ambiguous, malformed, multiline, image, already-wrapped, and non-local
 * tokens are left byte-identical.
 */
export function repairTranscriptFileLinks(source: string): string {
  let result = "";
  let cursor = 0;
  for (const link of scanTranscriptMarkdownLinks(source)) {
    if (link.isImage || link.destinationWrapped || link.multiline) continue;
    if (!link.destination.includes(" ")) continue;
    if (!isEligibleLocalFileDestination(link.destination)) continue;
    const encoded = link.destination.replaceAll(" ", "%20");
    const title = link.title ? ` ${link.title}` : "";
    result += `${source.slice(cursor, link.start)}[${link.label}](<${encoded}>${title})`;
    cursor = link.end;
  }
  return result + source.slice(cursor);
}

/**
 * Synthetically close an unambiguous trailing local-file link so the live
 * render copy can paint the mention before the real `)` arrives. Refuses code,
 * image, scheme, open-title, unbalanced-paren, and multiline tails.
 */
export function stabilizeStreamingFileLink(source: string): string {
  const masked = buildMarkdownCodeMask(source);
  // An unmatched backtick left in the live source may still close into a code
  // span around the tail once more text arrives, so stay out of that source
  // entirely. Closed spans and fences are already masked.
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "`" && !masked[index]) return source;
  }
  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (masked[index] || source[index] !== "[" || isEscaped(source, index)) continue;
    const closer = openTailCloser(source, masked, index);
    if (closer !== null) return `${source}${closer}`;
  }
  return source;
}

/** The characters that would close an eligible incomplete tail at `index`. */
function openTailCloser(source: string, masked: boolean[], index: number): string | null {
  if (index > 0 && source[index - 1] === "!" && !isEscaped(source, index - 1)) return null;
  const labelEnd = findLabelEnd(source, masked, index);
  if (labelEnd === null || source[labelEnd + 1] !== "(") return null;
  const tail = source.slice(labelEnd + 2);
  // Only an unterminated tail is stabilized; a closed link is already parseable.
  if (tail.includes("\n") || masked.slice(labelEnd + 2).some(Boolean)) return null;
  if (findDestinationEnd(source, masked, labelEnd + 2) !== null) return null;

  const wrapped = tail.startsWith("<");
  const inner = wrapped ? tail.slice(1) : tail;
  if (wrapped && (inner.includes("<") || inner.includes(">"))) return null;
  if (parenDepth(inner) !== 0) return null;
  const split = splitDestinationAndTitle(inner.trimStart());
  if (split === null) return null;
  if (!isEligibleLocalFileDestination(split.destination.trimEnd())) return null;
  return wrapped ? ">)" : ")";
}

function readLink(
  source: string,
  masked: boolean[],
  index: number,
): TranscriptMarkdownLink | null {
  const labelEnd = findLabelEnd(source, masked, index);
  if (labelEnd === null || source[labelEnd + 1] !== "(") return null;
  const innerStart = labelEnd + 2;
  const closeIndex = findDestinationEnd(source, masked, innerStart);
  if (closeIndex === null) return null;

  const rawInner = source.slice(innerStart, closeIndex);
  const split = splitDestinationAndTitle(rawInner.trim());
  if (split === null) return null;
  const destination = split.destination.trimEnd();
  const wrapped = destination.startsWith("<") && destination.endsWith(">");
  const isImage = index > 0 && source[index - 1] === "!" && !isEscaped(source, index - 1);
  return {
    start: index,
    end: closeIndex + 1,
    isImage,
    label: source.slice(index + 1, labelEnd),
    destination: wrapped ? destination.slice(1, -1) : destination,
    destinationWrapped: wrapped,
    title: split.title,
    multiline: source.slice(index, closeIndex + 1).includes("\n"),
  };
}

/** Index of the `]` closing the label opened at `index`, honouring nesting. */
function findLabelEnd(source: string, masked: boolean[], index: number): number | null {
  let depth = 0;
  for (let cursor = index; cursor < source.length; cursor += 1) {
    if (masked[cursor]) return null;
    const char = source[cursor];
    if (char === "\\") {
      cursor += 1;
      continue;
    }
    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return null;
}

/**
 * Index of the `)` closing the destination that starts at `from`.
 *
 * Runs quote-aware first so a quoted title may hold an unmatched `(` — the
 * quote, not the parenthesis, delimits a title. Falls back to plain balancing
 * so an unclosed quote still yields a token, which the title split then
 * rejects as malformed rather than silently repairing.
 */
function findDestinationEnd(source: string, masked: boolean[], from: number): number | null {
  return balancedCloseParen(source, masked, from, true)
    ?? balancedCloseParen(source, masked, from, false);
}

function balancedCloseParen(
  source: string,
  masked: boolean[],
  from: number,
  quoteAware: boolean,
): number | null {
  let depth = 1;
  let cursor = from;
  while (cursor < source.length) {
    if (masked[cursor]) return null;
    const char = source[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (quoteAware && isTitleQuoteStart(source, cursor, from)) {
      const close = findMatchingDelimiter(source, cursor);
      if (close === null) return null;
      cursor = close + 1;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
    cursor += 1;
  }
  return null;
}

function isTitleQuoteStart(source: string, cursor: number, from: number): boolean {
  const char = source[cursor];
  if (char !== "\"" && char !== "'") return false;
  return cursor > from && (source[cursor - 1] === " " || source[cursor - 1] === "\t");
}

/**
 * Split a link's inner text into destination and optional complete title.
 *
 * Returns null when a title-position delimiter opens and never closes: an
 * ambiguous token is left entirely unchanged rather than partially repaired.
 */
function splitDestinationAndTitle(
  inner: string,
): { destination: string; title: string | null } | null {
  for (let cursor = 0; cursor < inner.length; cursor += 1) {
    if (inner[cursor] !== " " && inner[cursor] !== "\t") continue;
    let start = cursor;
    while (start < inner.length && (inner[start] === " " || inner[start] === "\t")) start += 1;
    if (start >= inner.length) break;
    if (!"\"'(".includes(inner[start])) continue;
    const close = findMatchingDelimiter(inner, start);
    if (close === null) return null;
    if (inner.slice(close + 1).trim().length === 0) {
      return { destination: inner.slice(0, cursor), title: inner.slice(start, close + 1) };
    }
  }
  return { destination: inner, title: null };
}

/** Index of the delimiter closing the one opened at `start`, or null. */
function findMatchingDelimiter(value: string, start: number): number | null {
  const open = value[start];
  const close = open === "(" ? ")" : open;
  let depth = 1;
  for (let cursor = start + 1; cursor < value.length; cursor += 1) {
    const char = value[cursor];
    if (char === "\\") {
      cursor += 1;
      continue;
    }
    if (open === "(" && char === "(") depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return null;
}

/** Net unescaped parenthesis depth, ignoring text inside title-position quotes. */
function parenDepth(value: string): number {
  let depth = 0;
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    const char = value[cursor];
    if (char === "\\") {
      cursor += 1;
      continue;
    }
    if (isTitleQuoteStart(value, cursor, 0)) {
      const close = findMatchingDelimiter(value, cursor);
      if (close === null) return depth;
      cursor = close;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
  }
  return depth;
}

function isEscaped(source: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}
