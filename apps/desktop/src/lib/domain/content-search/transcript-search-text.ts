import type { TranscriptState } from "@anyharness/sdk";
import type { TranscriptVirtualRow } from "@proliferate/product-domain/chats/transcript/transcript-virtual-rows";

// Deterministic, cheap markdown-to-plain-text reduction used to COUNT content
// search matches in transcript prose. It approximates the text a reader sees
// once markdown is rendered: syntax markers are dropped, link/image labels are
// kept (URLs dropped), and fenced/inline code content is preserved. It does
// not need to match the painted DOM exactly — the paint layer highlights
// best-effort and the active-match jump clamps to whatever marks exist (see
// specs/codebase/features/content-search.md).

const FENCE_LINE = /^\s*(`{3,}|~{3,}).*$/;

export function stripMarkdownToSearchText(markdown: string): string {
  if (!markdown) {
    return "";
  }

  const lines = markdown.split("\n");
  const out: string[] = [];
  let inFence = false;

  for (const line of lines) {
    if (FENCE_LINE.test(line)) {
      // Drop the fence marker line itself; keep the code body between fences.
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    out.push(stripInlineMarkdown(stripBlockPrefix(line)));
  }

  return out.join("\n");
}

// Removes leading block markers (heading #, blockquote >, list bullets and
// ordered markers) so their punctuation isn't matched as content.
function stripBlockPrefix(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "");
}

/**
 * Extracts the searchable prose segments of a transcript row: user-message
 * text (plain) and assistant prose (markdown-stripped). Tool-call rows, their
 * (collapsed) output bodies, reasoning, and plan cards are intentionally out of
 * scope — they are not part of the conversation prose the paint layer
 * highlights. Returns one string per prose item so match counting mirrors the
 * per-message paint. See specs/codebase/features/content-search.md.
 */
export function extractTranscriptRowProseSegments(
  row: TranscriptVirtualRow,
  transcript: TranscriptState,
): string[] {
  if (row.kind !== "turn") {
    return [];
  }

  const segments: string[] = [];
  for (const block of row.renderPresentation.displayBlocks) {
    if (block.kind !== "item") {
      // Tool blocks (collapsed_actions / inline_tools / inline_tool /
      // subagent_creations) are out of scope.
      continue;
    }
    const item = transcript.itemsById[block.itemId];
    if (!item) {
      continue;
    }
    if (item.kind === "user_message") {
      const text = item.text.trim();
      if (text) {
        segments.push(text);
      }
    } else if (item.kind === "assistant_prose") {
      const text = stripMarkdownToSearchText(item.text).trim();
      if (text) {
        segments.push(text);
      }
    }
  }
  return segments;
}

function stripInlineMarkdown(text: string): string {
  return text
    // Images and links: keep the label, drop the target.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Inline code: keep the content, drop the backticks.
    .replace(/`([^`]*)`/g, "$1")
    // Emphasis / strong markers.
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    // Strikethrough.
    .replace(/~~(.*?)~~/g, "$1");
}
